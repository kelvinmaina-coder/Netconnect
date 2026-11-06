"""Tests for milestone 3 messaging and room functionality."""
from fastapi.testclient import TestClient

from backend.database.database import initialize_database
from backend.security.auth_service import ensure_default_admin
from backend.api.app import app


def setup_function() -> None:
    initialize_database()
    ensure_default_admin(username="admin", password="Admin@12345")


def test_user_can_create_and_join_room_and_send_message():
    client = TestClient(app)
    client.post("/api/v1/auth/register", json={"username": "diana", "password": "StrongPass999"})
    token = client.post("/api/v1/auth/login", json={"username": "diana", "password": "StrongPass999"}).json()["token"]
    room = client.post("/api/v1/rooms", json={"name": "Programming", "description": "Code discussion"}, headers={"Authorization": f"Bearer {token}"})
    assert room.status_code == 200, room.text
    room_id = room.json()["room"]["id"]
    join = client.post(f"/api/v1/rooms/{room_id}/join", headers={"Authorization": f"Bearer {token}"})
    assert join.status_code == 200, join.text
    sent = client.post(f"/api/v1/rooms/{room_id}/messages", json={"content": "hello room"}, headers={"Authorization": f"Bearer {token}"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["data"]["content"] == "hello room"


def test_private_message_can_be_sent_between_users():
    client = TestClient(app)
    client.post("/api/v1/auth/register", json={"username": "alice", "password": "StrongPass111"})
    client.post("/api/v1/auth/register", json={"username": "bob", "password": "StrongPass222"})
    alice_token = client.post("/api/v1/auth/login", json={"username": "alice", "password": "StrongPass111"}).json()["token"]
    bob_id = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {client.post('/api/v1/auth/login', json={{'username':'admin','password':'Admin@12345'}}).json()['token']}"}).json()["users"]
    bob = next(item for item in bob_id if item["username"] == "bob")
    sent = client.post(
        "/api/v1/messages/private",
        json={"content": "hi bob", "recipient_id": bob["id"]},
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["data"]["content"] == "hi bob"


def test_room_list_and_conversation_list_work_for_authenticated_user():
    client = TestClient(app)
    client.post("/api/v1/auth/register", json={"username": "erin", "password": "StrongPass333"})
    token = client.post("/api/v1/auth/login", json={"username": "erin", "password": "StrongPass333"}).json()["token"]
    room_response = client.post("/api/v1/rooms", json={"name": "General Discussion", "description": "All say hi"}, headers={"Authorization": f"Bearer {token}"})
    assert room_response.status_code == 200, room_response.text
    rooms = client.get("/api/v1/rooms", headers={"Authorization": f"Bearer {token}"})
    assert rooms.status_code == 200, rooms.text
    assert len(rooms.json()["rooms"]) >= 1
    conversations = client.get("/api/v1/messages/conversations", headers={"Authorization": f"Bearer {token}"})
    assert conversations.status_code == 200, conversations.text
