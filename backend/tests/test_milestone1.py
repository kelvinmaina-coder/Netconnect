"""Milestone 1 integration tests for the real TCP server and SQLite schema."""
import json
import socket
import struct
import threading
import time

import pytest
from sqlalchemy import select

from backend.database.database import initialize_database, session_scope
from backend.database.models import Role
from backend.network.protocol import recv_frame, send_frame
from backend.server.echo_server import ConcurrentEchoServer


@pytest.fixture
def running_server():
    server = ConcurrentEchoServer(host="127.0.0.1", port=0)
    thread = threading.Thread(target=server.serve_forever, name="test-accept-loop", daemon=True)
    thread.start()
    deadline = time.time() + 3
    while server._listener is None and time.time() < deadline:
        time.sleep(0.01)
    assert server._listener is not None, "server failed to bind in time"
    yield server
    server.stop()
    thread.join(timeout=3)


def test_welcome_and_echo(running_server):
    with socket.create_connection(running_server.address, timeout=2) as client:
        welcome = recv_frame(client)
        assert welcome["type"] == "welcome"
        assert welcome["client_id"]
        payload = {"type": "message", "text": "hello"}
        send_frame(client, payload)
        response = recv_frame(client)
        assert response == {"type": "echo", "client_id": welcome["client_id"], "payload": payload}


def test_multiple_clients_are_tracked_and_echo_independently(running_server):
    clients = [socket.create_connection(running_server.address, timeout=2) for _ in range(3)]
    try:
        welcomes = [recv_frame(client) for client in clients]
        assert len({item["client_id"] for item in welcomes}) == 3
        deadline = time.time() + 2
        while len(running_server.active_clients) != 3 and time.time() < deadline:
            time.sleep(0.01)
        assert len(running_server.active_clients) == 3
        handler_names = [item["thread"] for item in running_server.active_clients]
        assert len(set(handler_names)) == 3
        for index, client in enumerate(clients):
            send_frame(client, {"type": "message", "text": f"client-{index}"})
        responses = [recv_frame(client) for client in clients]
        assert [response["payload"]["text"] for response in responses] == ["client-0", "client-1", "client-2"]
    finally:
        for client in clients:
            client.close()


def test_disconnect_notifies_other_clients_and_server_keeps_running(running_server):
    observer = socket.create_connection(running_server.address, timeout=2)
    departing = socket.create_connection(running_server.address, timeout=2)
    try:
        observer_welcome = recv_frame(observer)
        departing_welcome = recv_frame(departing)
        departing.shutdown(socket.SHUT_RDWR)
        departing.close()
        notice = recv_frame(observer)
        assert notice["type"] == "user_disconnected"
        assert notice["client_id"] == departing_welcome["client_id"]
        send_frame(observer, {"type": "message", "text": "still alive"})
        assert recv_frame(observer)["payload"]["text"] == "still alive"
        assert observer_welcome["client_id"] != departing_welcome["client_id"]
    finally:
        observer.close()
        departing.close()


def test_database_initialization_seeds_roles(tmp_path):
    initialize_database(f"sqlite:///{tmp_path / 'test.db'}")
    with session_scope() as session:
        role_names = set(session.scalars(select(Role.name)).all())
    assert role_names == {"administrator", "user"}


def test_protocol_handles_header_and_body_sent_in_fragments(running_server):
    with socket.create_connection(running_server.address, timeout=2) as client:
        welcome = recv_frame(client)
        body = json.dumps({"type": "message", "text": "fragmented"}).encode()
        frame = struct.pack("!I", len(body)) + body
        for byte in frame:
            client.sendall(bytes([byte]))
        response = recv_frame(client)
        assert response["client_id"] == welcome["client_id"]
        assert response["payload"]["text"] == "fragmented"
