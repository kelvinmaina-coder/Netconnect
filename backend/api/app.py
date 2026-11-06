"""FastAPI entry points for milestone 2 authentication and RBAC."""
from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from backend.database.database import initialize_database
from backend.database.models import User
from backend.security.auth_service import authenticate_user, get_user_by_id, get_user_by_token, list_users, logout_user, register_user, update_user_suspension

app = FastAPI(title="NetConnect API", version="0.2.0")
security = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    username: str = Field(...)
    password: str = Field(...)


class StatusUpdateRequest(BaseModel):
    is_suspended: bool = Field(default=False)


@app.on_event("startup")
def _startup() -> None:
    initialize_database()


def _extract_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or creds := credentials.credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    return credentials.credentials


def _require_auth(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> User:
    token = _extract_token(credentials)
    user = get_user_by_token(token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token")
    return user


def _require_admin(current_user: User = Depends(_require_auth)) -> User:
    if current_user.role.name != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="administrator privileges required")
    return current_user


@app.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest):
    try:
        created = register_user(payload.username, payload.password)
        return {"message": "user registered successfully", "user": created}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/api/v1/auth/login")
def login(payload: LoginRequest):
    try:
        user, token = authenticate_user(payload.username, payload.password, ip_address="api")
        return {"message": "login successful", "token": token, "user": user}
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@app.post("/api/v1/auth/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    token = _extract_token(credentials)
    if not logout_user(token):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="token not found")
    return {"message": "logout successful"}


@app.get("/api/v1/users/me")
def get_me(current_user: User = Depends(_require_auth)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role.name,
        "status": current_user.status,
        "is_suspended": current_user.is_suspended,
    }


@app.get("/api/v1/admin/users")
def list_all_users(current_user: User = Depends(_require_admin)):
    del current_user
    return {"users": list_users()}


@app.patch("/api/v1/admin/users/{user_id}/status")
def update_status(user_id: int, payload: StatusUpdateRequest, _current_user: User = Depends(_require_admin)):
    try:
        updated = update_user_suspension(user_id, payload.is_suspended)
        return {"message": "user status updated", "user": updated}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/api/v1/admin/users/{user_id}")
def get_user(user_id: int, _current_user: User = Depends(_require_admin)):
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role.name,
        "status": user.status,
        "is_suspended": user.is_suspended,
    }
