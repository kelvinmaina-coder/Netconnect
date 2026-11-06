"""Thread-per-client TCP echo server for the NetConnect academic project."""
from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from backend.network.protocol import DEFAULT_MAX_FRAME_BYTES, ProtocolError, recv_frame, send_frame


@dataclass
class ClientConnection:
    client_id: str
    sock: socket.socket
    address: tuple[str, int]
    connected_at: float = field(default_factory=time.time)
    send_lock: threading.Lock = field(default_factory=threading.Lock)
    bytes_received: int = 0
    bytes_sent: int = 0


class ConcurrentEchoServer:
    """A small concurrent TCP server; each accepted client gets one thread."""

    def __init__(self, host: str = "127.0.0.1", port: int = 9000, max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES):
        if not 0 <= port <= 65535:
            raise ValueError("port must be between 0 and 65535")
        if max_frame_bytes < 1:
            raise ValueError("max_frame_bytes must be positive")
        self.host = host
        self.port = port
        self.max_frame_bytes = max_frame_bytes
        self._lock = threading.RLock()
        self._clients: dict[str, ClientConnection] = {}
        self._handler_threads: set[threading.Thread] = set()
        self._listener: socket.socket | None = None
        self._stop_event = threading.Event()
        self._started_at: float | None = None
        self.total_bytes_received = 0
        self.total_bytes_sent = 0
        self.connection_count = 0

    @property
    def address(self) -> tuple[str, int]:
        if self._listener is None:
            return self.host, self.port
        return self._listener.getsockname()[:2]

    @property
    def active_clients(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {"client_id": c.client_id, "ip": c.address[0], "port": c.address[1], "connected_at": c.connected_at,
                 "thread": next((t.name for t in self._handler_threads if t.name == f"client-{c.client_id}"), None)}
                for c in self._clients.values()
            ]

    @property
    def uptime_seconds(self) -> float:
        return 0.0 if self._started_at is None else max(0.0, time.time() - self._started_at)

    def serve_forever(self) -> None:
        """Bind/listen and accept until stop() is called."""
        if self._listener is not None:
            raise RuntimeError("server has already been started")
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((self.host, self.port))
        listener.listen()
        listener.settimeout(0.25)
        self._listener = listener
        self.port = listener.getsockname()[1]
        self._started_at = time.time()
        print(f"NetConnect TCP echo server listening on {self.host}:{self.port}", flush=True)
        try:
            while not self._stop_event.is_set():
                try:
                    client_sock, address = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    if self._stop_event.is_set():
                        break
                    raise
                client_id = uuid.uuid4().hex
                connection = ClientConnection(client_id, client_sock, (address[0], address[1]))
                with self._lock:
                    self._clients[client_id] = connection
                    self.connection_count += 1
                    handler = threading.Thread(target=self._handle_client, args=(connection,), name=f"client-{client_id}", daemon=True)
                    self._handler_threads.add(handler)
                print(f"CONNECTED id={client_id} peer={address[0]}:{address[1]} thread={handler.name}", flush=True)
                handler.start()
        finally:
            self.stop()

    def stop(self) -> None:
        """Stop accepting and close active sockets; safe to call more than once."""
        self._stop_event.set()
        listener = self._listener
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        with self._lock:
            sockets = [connection.sock for connection in self._clients.values()]
            threads = list(self._handler_threads)
        for sock in sockets:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        current = threading.current_thread()
        for thread in threads:
            if thread is not current and thread.is_alive():
                thread.join(timeout=1.0)

    def _send(self, connection: ClientConnection, message: dict[str, Any]) -> bool:
        try:
            with connection.send_lock:
                sent = send_frame(connection.sock, message, self.max_frame_bytes)
            connection.bytes_sent += sent
            with self._lock:
                self.total_bytes_sent += sent
            return True
        except (OSError, ProtocolError):
            return False

    def _broadcast(self, message: dict[str, Any], exclude: str | None = None) -> None:
        with self._lock:
            recipients = [c for key, c in self._clients.items() if key != exclude]
        for recipient in recipients:
            if not self._send(recipient, message):
                try:
                    recipient.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def _handle_client(self, connection: ClientConnection) -> None:
        try:
            if not self._send(connection, {"type": "welcome", "client_id": connection.client_id,
                                           "message": "Connected to the NetConnect TCP echo server."}):
                return
            while not self._stop_event.is_set():
                message = recv_frame(connection.sock, self.max_frame_bytes)
                # Account for the complete wire bytes (4-byte header + JSON body).
                import json
                import struct
                received_bytes = 4 + len(json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
                connection.bytes_received += received_bytes
                with self._lock:
                    self.total_bytes_received += received_bytes
                if message.get("type") == "identify":
                    username = message.get("username")
                    if isinstance(username, str) and 1 <= len(username.strip()) <= 32:
                        message = {**message, "username": username.strip()}
                if not self._send(connection, {"type": "echo", "client_id": connection.client_id, "payload": message}):
                    break
        except EOFError:
            pass
        except (OSError, ProtocolError) as exc:
            if not self._stop_event.is_set():
                print(f"CLIENT ERROR id={connection.client_id}: {exc}", flush=True)
        finally:
            removed = False
            with self._lock:
                if self._clients.pop(connection.client_id, None) is not None:
                    removed = True
                self._handler_threads.discard(threading.current_thread())
            try:
                connection.sock.close()
            except OSError:
                pass
            if removed:
                print(f"DISCONNECTED id={connection.client_id} peer={connection.address[0]}:{connection.address[1]}", flush=True)
                if not self._stop_event.is_set():
                    self._broadcast({"type": "user_disconnected", "client_id": connection.client_id,
                                     "message": "A TCP client disconnected."})


def main() -> None:
    host = os.getenv("NETCONNECT_TCP_HOST", "127.0.0.1")
    port = int(os.getenv("NETCONNECT_TCP_PORT", "9000"))
    max_frame_bytes = int(os.getenv("NETCONNECT_MAX_FRAME_BYTES", str(DEFAULT_MAX_FRAME_BYTES)))
    server = ConcurrentEchoServer(host=host, port=port, max_frame_bytes=max_frame_bytes)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutdown requested.", flush=True)
    finally:
        server.stop()
        print("NetConnect TCP echo server stopped.", flush=True)


if __name__ == "__main__":
    main()
