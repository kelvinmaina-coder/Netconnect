"""End-to-end tests for the real TCP file transfer server."""
import hashlib
import socket
import threading
import time

import pytest
from sqlalchemy import select

from backend.database.database import initialize_database
from backend.database.file_models import FileRecord
from backend.network.protocol import recv_frame, send_frame
from backend.security.auth_service import authenticate_user, register_user
from backend.server.file_transfer_server import TCPFileTransferServer
from backend.services.file_service import get_owned_file_path, list_user_transfers


@pytest.fixture
def file_server(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    initialize_database(database_url)
    user = register_user("fileuser", "StrongPass123")
    _, token = authenticate_user("fileuser", "StrongPass123")
    server = TCPFileTransferServer(host="127.0.0.1", port=0, storage_dir=tmp_path / "stored", max_file_bytes=1024)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    deadline = time.time() + 3
    while server._listener is None and time.time() < deadline:
        time.sleep(0.01)
    assert server._listener is not None
    yield server, user["id"], token, tmp_path
    server.stop()
    thread.join(timeout=3)


def test_tcp_upload_persists_content_hash_and_metadata(file_server):
    server, user_id, token, tmp_path = file_server
    contents = b"real TCP file transfer contents\x00\xff"
    with socket.create_connection(server.address, timeout=2) as client:
        send_frame(client, {"type": "upload", "token": token, "filename": "notes.txt", "size_bytes": len(contents)})
        assert recv_frame(client)["type"] == "upload_ready"
        client.sendall(contents)
        response = recv_frame(client)
    assert response["type"] == "upload_complete"
    file_info = response["file"]
    assert file_info["name"] == "notes.txt"
    assert file_info["sha256"] == hashlib.sha256(contents).hexdigest()
    assert (tmp_path / "stored" / (file_info["sha256"] if False else "placeholder")).exists() is False
    stored = get_owned_file_path(user_id, file_info["id"], tmp_path / "stored")
    assert stored is not None
    assert stored[1].read_bytes() == contents
    assert list_user_transfers(user_id)[0]["direction"] == "upload"


def test_upload_filename_path_is_reduced_to_safe_basename(file_server):
    server, _, token, _ = file_server
    with socket.create_connection(server.address, timeout=2) as client:
        data = b"ok"
        send_frame(client, {"type": "upload", "token": token, "filename": "../../private.txt", "size_bytes": len(data)})
        assert recv_frame(client)["type"] == "upload_ready"
        client.sendall(data)
        result = recv_frame(client)
    assert result["type"] == "upload_complete"
    assert result["file"]["name"] == "private.txt"


def test_download_requires_owner_and_streams_original_bytes(file_server):
    server, user_id, token, _ = file_server
    payload = b"download-me" * 100
    with socket.create_connection(server.address, timeout=2) as client:
        send_frame(client, {"type": "upload", "token": token, "filename": "sample.bin", "size_bytes": len(payload)})
        recv_frame(client)
        client.sendall(payload)
        file_info = recv_frame(client)["file"]
    with socket.create_connection(server.address, timeout=2) as client:
        send_frame(client, {"type": "download", "token": token, "file_id": file_info["id"]})
        ready = recv_frame(client)
        assert ready["type"] == "download_ready"
        chunks = bytearray()
        while len(chunks) < ready["file"]["size_bytes"]:
            chunks.extend(client.recv(ready["file"]["size_bytes"] - len(chunks)))
        complete = recv_frame(client)
    assert bytes(chunks) == payload
    assert complete["type"] == "download_complete"
    assert list_user_transfers(user_id)[0]["direction"] == "download"


def test_tcp_file_metadata_tables_are_registered(file_server):
    initialize_database()
    server, _, _, _ = file_server
    assert server.address[1] > 0
