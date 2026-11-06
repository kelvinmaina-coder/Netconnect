"""Tests for the authentication and RBAC milestone."""
from fastapi.testclient import TestClient

from backend.database.database import initialize_database
from backend.security.auth_service import ensure_default_admin
from backend.api.app import app


def setup_function() -> None:
    initialize_database()
    ensure_default_admin(username="admin", password="Admin@12345")


def test_register_and_login_user():
    client = TestClient(app)
    response = client.post("/api/v1/auth/register", json={"username": "alice", "password": "StrongPass123"})
    assert response.status_code == 201, response.text
    login = client.post("/api/v1/auth/login", json={"username": "alice", "password": "StrongPass123"})
    assert login.status_code == 200, login.text
    payload = login.json()
    assert payload["token"]
    assert payload["user"]["username"] == "alice"


def test_admin_route_requires_admin_permissions():
    client = TestClient(app)
    admin_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@12345"})
    token = admin_login.json()["token"]
    users_response = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert users_response.status_code == 200, users_response.text
    assert users_response.json()["users"]

    user_login = client.post("/api/v1/auth/register", json={"username": "bob", "password": "SecurePass123"})
    assert user_login.status_code == 201
    bob_token = client.post("/api/v1/auth/login", json={"username": "bob", "password": "SecurePass123"}).json()["token"]
    forbidden = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {bob_token}"})
    assert forbidden.status_code == 403, forbidden.text


def test_user_can_be_suspended_by_admin():
    client = TestClient(app)
    client.post("/api/v1/auth/register", json={"username": "charlie", "password": "StrongPass456"})
    admin_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@12345"})
    token = admin_login.json()["token"]
    lookup = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"}).json()["users"]
    charlie = next(item for item in lookup if item["username"] == "charlie")
    suspend = client.patch(
        f"/api/v1/admin/users/{charlie['id']}/status",
        json={"is_suspended": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert suspend.status_code == 200, suspend.text
    assert suspend.json()["user"]["is_suspended"] is True
    login_after = client.post("/api/v1/auth/login", json={"username": "charlie", "password": "StrongPass456"})
    assert login_after.status_code == 401, login_after.text
