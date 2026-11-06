"""CLI client for uploading and downloading files over NetConnect TCP."""
from __future__ import annotations

import argparse
import hashlib
import os
import socket
from pathlib import Path

from backend.network.protocol import recv_frame, send_frame
from backend.server.file_transfer_server import CHUNK_BYTES


def _receive_exactly(sock: socket.socket, count: int, destination=None) -> bytes:
    remaining = count
    collected = bytearray()
    digest = hashlib.sha256()
    while remaining:
        chunk = sock.recv(min(CHUNK_BYTES, remaining))
        if not chunk:
            raise EOFError("server closed connection before all file bytes arrived")
        remaining -= len(chunk)
        digest.update(chunk)
        if destination is None:
            collected.extend(chunk)
        else:
            destination.write(chunk)
    return bytes(collected) if destination is None else digest.digest()


def upload_file(host: str, port: int, token: str, path: Path) -> dict:
    size = path.stat().st_size
    with socket.create_connection((host, port), timeout=30) as sock:
        sock.settimeout(30)
        send_frame(sock, {"type": "upload", "token": token, "filename": path.name, "size_bytes": size})
        ready = recv_frame(sock)
        if ready.get("type") != "upload_ready":
            raise RuntimeError(ready.get("message", "upload was not accepted"))
        with path.open("rb") as source:
            while chunk := source.read(CHUNK_BYTES):
                sock.sendall(chunk)
        response = recv_frame(sock)
        if response.get("type") != "upload_complete":
            raise RuntimeError(response.get("message", "upload failed"))
        return response["file"]


def download_file(host: str, port: int, token: str, file_id: int, output: Path) -> dict:
    with socket.create_connection((host, port), timeout=30) as sock:
        sock.settimeout(30)
        send_frame(sock, {"type": "download", "token": token, "file_id": file_id})
        ready = recv_frame(sock)
        if ready.get("type") != "download_ready":
            raise RuntimeError(ready.get("message", "download was not accepted"))
        metadata = ready["file"]
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_name(output.name + ".part")
        try:
            with temp.open("wb") as destination:
                digest_bytes = _receive_exactly(sock, metadata["size_bytes"], destination)
            complete = recv_frame(sock)
            if complete.get("type") != "download_complete":
                raise RuntimeError(complete.get("message", "download did not complete"))
            if digest_bytes.hex() != metadata["sha256"]:
                raise RuntimeError("download checksum verification failed")
            os.replace(temp, output)
        except Exception:
            temp.unlink(missing_ok=True)
            raise
        return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--token", default=os.getenv("NETCONNECT_TOKEN"), help="API bearer token; defaults to NETCONNECT_TOKEN")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    upload = subparsers.add_parser("upload")
    upload.add_argument("path", type=Path)
    download = subparsers.add_parser("download")
    download.add_argument("file_id", type=int)
    download.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or set NETCONNECT_TOKEN")
    if args.operation == "upload":
        result = upload_file(args.host, args.port, args.token, args.path)
        print(f"Uploaded {result['name']} as file ID {result['id']} ({result['size_bytes']} bytes, SHA-256 {result['sha256']})")
    else:
        result = download_file(args.host, args.port, args.token, args.file_id, args.output)
        print(f"Downloaded {result['name']} to {args.output} ({result['size_bytes']} bytes)")


if __name__ == "__main__":
    main()
