"""Concurrent TCP file server for bounded, authenticated file uploads/downloads.

Control messages use the regular length-prefixed JSON protocol. Upload data and
file download bytes then travel as raw TCP bytes, exactly `size_bytes` bytes.
This service is deliberately separate from FastAPI and the echo server.
"""
from __future__ import annotations

import hashlib
import os
import socket
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import BinaryIO

from backend.database.database import initialize_database
from backend.network.protocol import DEFAULT_MAX_FRAME_BYTES, ProtocolError, recv_frame, send_frame
from backend.security.auth_service import get_user_by_token
from backend.services.file_service import (
    get_owned_file_path,
    record_completed_upload,
    record_download,
    record_failed_transfer,
)

CHUNK_BYTES = 64 * 1024
DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024


def _recv_exactly(sock: socket.socket, count: int, output: BinaryIO | None = None) -> bytes:
    remaining = count
    collected = bytearray()
    while remaining:
        chunk = sock.recv(min(CHUNK_BYTES, remaining))
        if not chunk:
            raise EOFError("connection closed before the full file was transferred")
        remaining -= len(chunk)
        if output is None:
            collected.extend(chunk)
        else:
            output.write(chunk)
    return bytes(collected)


def _safe_filename(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("filename must be text")
    # Treat both separator styles as paths regardless of server operating system.
    name = value.replace("\\", "/").split("/")[-1]
    name = "".join(char for char in name if char.isprintable() and char not in "\x00/\\")
    name = name.strip(" .")
    if not name or name in {".", ".."} or len(name.encode("utf-8")) > 255:
        raise ValueError("filename is invalid or too long")
    return name


class TCPFileTransferServer:
    """One thread per TCP connection; files are written atomically to private storage."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 9100,
        storage_dir: str | Path = "uploads/files",
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
        socket_timeout: float = 30.0,
    ):
        if not 0 <= port <= 65535:
            raise ValueError("port must be between 0 and 65535")
        if max_file_bytes < 0:
            raise ValueError("max_file_bytes must not be negative")
        self.host = host
        self.port = port
        self.storage_dir = Path(storage_dir).resolve()
        self.max_file_bytes = max_file_bytes
        self.socket_timeout = socket_timeout
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self._listener: socket.socket | None = None
        self._threads: set[threading.Thread] = set()
        self._started_at: float | None = None
        self.active_connections = 0

    @property
    def address(self) -> tuple[str, int]:
        return self._listener.getsockname()[:2] if self._listener else (self.host, self.port)

    @property
    def uptime_seconds(self) -> float:
        return max(0.0, time.time() - self._started_at) if self._started_at else 0.0

    def serve_forever(self) -> None:
        if self._listener is not None:
            raise RuntimeError("file server has already been started")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        initialize_database()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((self.host, self.port))
        listener.listen()
        listener.settimeout(0.25)
        self._listener = listener
        self.port = listener.getsockname()[1]
        self._started_at = time.time()
        print(f"NetConnect TCP file server listening on {self.host}:{self.port}", flush=True)
        try:
            while not self._stop.is_set():
                try:
                    client, address = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    if self._stop.is_set():
                        break
                    raise
                client.settimeout(self.socket_timeout)
                with self._lock:
                    self.active_connections += 1
                    thread = threading.Thread(target=self._handle, args=(client, address), daemon=True, name=f"file-client-{address[0]}:{address[1]}")
                    self._threads.add(thread)
                thread.start()
        finally:
            self.stop()

    def stop(self) -> None:
        self._stop.set()
        if self._listener:
            try:
                self._listener.close()
            except OSError:
                pass
        with self._lock:
            threads = list(self._threads)
        current = threading.current_thread()
        for thread in threads:
            if thread is not current and thread.is_alive():
                thread.join(timeout=1.0)

    def _handle(self, client: socket.socket, address: tuple[str, int]) -> None:
        user_id: int | None = None
        direction = "unknown"
        filename = "unknown"
        size = 0
        temp_path: Path | None = None
        print(f"FILE CONNECTED peer={address[0]}:{address[1]}", flush=True)
        try:
            request = recv_frame(client, DEFAULT_MAX_FRAME_BYTES)
            if request.get("type") not in {"upload", "download"}:
                raise ValueError("unsupported file-transfer operation")
            direction = request["type"]
            user = get_user_by_token(str(request.get("token", "")))
            if user is None or user.is_suspended:
                send_frame(client, {"type": "error", "message": "authentication failed"})
                return
            user_id = user.id
            if direction == "upload":
                filename = _safe_filename(request.get("filename"))
                size = request.get("size_bytes")
                if isinstance(size, bool) or not isinstance(size, int) or size < 0 or size > self.max_file_bytes:
                    raise ValueError(f"size_bytes must be between 0 and {self.max_file_bytes}")
                content_type = request.get("content_type", "application/octet-stream")
                if not isinstance(content_type, str) or len(content_type) > 128:
                    raise ValueError("content_type is invalid")
                send_frame(client, {"type": "upload_ready", "size_bytes": size})
                self.storage_dir.mkdir(parents=True, exist_ok=True)
                temp_fd, temp_name = tempfile.mkstemp(prefix=".upload-", suffix=".part", dir=self.storage_dir)
                temp_path = Path(temp_name)
                digest = hashlib.sha256()
                with os.fdopen(temp_fd, "wb") as output:
                    remaining = size
                    while remaining:
                        chunk = client.recv(min(CHUNK_BYTES, remaining))
                        if not chunk:
                            raise EOFError("connection closed before the full file was transferred")
                        output.write(chunk)
                        digest.update(chunk)
                        remaining -= len(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                stored_name = f"{uuid.uuid4().hex}.bin"
                final_path = self.storage_dir / stored_name
                os.replace(temp_path, final_path)
                temp_path = None
                file_record = record_completed_upload(user_id, filename, stored_name, size, digest.hexdigest())
                # Persist the declared content type without trusting it for serving/execution.
                from backend.database.database import session_scope
                from backend.database.file_models import FileRecord
                from sqlalchemy import select
                with session_scope() as session:
                    row = session.execute(select(FileRecord).where(FileRecord.id == file_record["id"])).scalar_one()
                    row.content_type = content_type
                send_frame(client, {"type": "upload_complete", "file": file_record})
            else:
                file_id = request.get("file_id")
                if isinstance(file_id, bool) or not isinstance(file_id, int) or file_id <= 0:
                    raise ValueError("file_id must be a positive integer")
                owned = get_owned_file_path(user_id, file_id, self.storage_dir)
                if owned is None:
                    send_frame(client, {"type": "error", "message": "file not found"})
                    return
                file_record, path = owned
                filename = file_record["name"]
                size = file_record["size_bytes"]
                send_frame(client, {"type": "download_ready", "file": file_record})
                with path.open("rb") as source:
                    while chunk := source.read(CHUNK_BYTES):
                        client.sendall(chunk)
                record_download(user_id, file_id, filename, size, file_record["sha256"])
                send_frame(client, {"type": "download_complete", "file_id": file_id, "sha256": file_record["sha256"]})
        except (EOFError, OSError, ProtocolError, ValueError, TypeError) as exc:
            if user_id is not None:
                try:
                    record_failed_transfer(user_id, direction, filename, size)
                except Exception as audit_exc:
                    print(f"FILE AUDIT ERROR peer={address}: {audit_exc}", flush=True)
            try:
                send_frame(client, {"type": "error", "message": str(exc)[:200]})
            except (OSError, ProtocolError):
                pass
            if not isinstance(exc, (ValueError, TypeError)):
                print(f"FILE TRANSFER ERROR peer={address}: {exc}", flush=True)
        finally:
            if temp_path:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                client.close()
            except OSError:
                pass
            with self._lock:
                self.active_connections = max(0, self.active_connections - 1)
                self._threads.discard(threading.current_thread())
            print(f"FILE DISCONNECTED peer={address[0]}:{address[1]}", flush=True)


def main() -> None:
    host = os.getenv("NETCONNECT_FILE_TCP_HOST", "127.0.0.1")
    port = int(os.getenv("NETCONNECT_FILE_TCP_PORT", "9100"))
    max_size = int(os.getenv("NETCONNECT_MAX_FILE_BYTES", str(DEFAULT_MAX_FILE_BYTES)))
    storage = os.getenv("NETCONNECT_UPLOAD_DIR", "uploads/files")
    server = TCPFileTransferServer(host, port, storage, max_size)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nFile server shutdown requested.", flush=True)
    finally:
        server.stop()
        print("NetConnect TCP file server stopped.", flush=True)


if __name__ == "__main__":
    main()
