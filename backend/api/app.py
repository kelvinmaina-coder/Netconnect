"""FastAPI HTTP API for NetConnect authentication, messaging, rooms and files."""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.database.database import initialize_database, session_scope
from backend.database.models import RoomMember, User
from backend.security.auth_service import (
    authenticate_user, get_user_by_id, get_user_by_token, list_users, logout_user,
    register_user, update_user_suspension,
)
from backend.services.messaging_service import (
    create_room, get_room_messages, get_user_conversations, join_room, list_rooms,
    send_private_message, send_room_message,
)
from backend.api.chat_routes import router as chat_router
from backend.api.realtime import hub, router as realtime_router

app = FastAPI(title="NetConnect API", version="0.5.0")
_origins = [origin.strip() for origin in os.getenv(
    "NETCONNECT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware, allow_origins=_origins, allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Authorization", "Content-Type"],
)
security = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    username: str
    password: str


class StatusUpdateRequest(BaseModel):
    is_suspended: bool = False


class MessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    recipient_id: int | None = None
    room_id: int | None = None


class RoomRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=80)
    description: str | None = Field(default=None, max_length=255)


@app.on_event("startup")
def _startup() -> None:
    initialize_database()


def _extract_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    return credentials.credentials


def _require_auth(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> User:
    user = get_user_by_token(_extract_token(credentials))
    if user is None or user.is_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid, expired, or suspended account")
    return user


def _require_admin(current_user: User = Depends(_require_auth)) -> User:
    if current_user.role.name != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="administrator privileges required")
    return current_user


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "NetConnect API"}


@app.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> dict:
    try:
        return {"message": "user registered successfully", "user": register_user(payload.username, payload.password)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/api/v1/auth/login")
def login(payload: LoginRequest) -> dict:
    try:
        user, token = authenticate_user(payload.username, payload.password, ip_address="api")
        return {"message": "login successful", "token": token, "user": user}
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@app.post("/api/v1/auth/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    if not logout_user(_extract_token(credentials)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="token not found")
    return {"message": "logout successful"}


@app.get("/api/v1/users/me")
def get_me(current_user: User = Depends(_require_auth)) -> dict:
    return {"id": current_user.id, "username": current_user.username, "role": current_user.role.name,
            "status": current_user.status, "is_suspended": current_user.is_suspended}


@app.get("/api/v1/admin/users")
def list_all_users(current_user: User = Depends(_require_admin)) -> dict:
    del current_user
    return {"users": list_users()}


@app.patch("/api/v1/admin/users/{user_id}/status")
def update_status(user_id: int, payload: StatusUpdateRequest, current_user: User = Depends(_require_admin)) -> dict:
    if user_id == current_user.id and payload.is_suspended:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="administrators cannot suspend their own account")
    try:
        updated = update_user_suspension(user_id, payload.is_suspended)
        return {"message": "user status updated", "user": updated}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/api/v1/admin/users/{user_id}")
def get_user(user_id: int, _current_user: User = Depends(_require_admin)) -> dict:
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return {"id": user.id, "username": user.username, "role": user.role.name,
            "status": user.status, "is_suspended": user.is_suspended}


@app.get("/api/v1/messages/conversations")
def list_conversations(current_user: User = Depends(_require_auth)) -> dict:
    return {"conversations": get_user_conversations(current_user.id)}


@app.post("/api/v1/messages/private")
async def send_private(payload: MessageRequest, current_user: User = Depends(_require_auth)) -> dict:
    if payload.recipient_id is None or payload.room_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="provide recipient_id only for private messages")
    try:
        message = send_private_message(current_user.id, payload.recipient_id, payload.content)
        await hub.send_users({current_user.id, payload.recipient_id}, {"type": "private_message", "data": message})
        return {"message": "private message sent", "data": message}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/api/v1/rooms")
def list_communication_rooms(current_user: User = Depends(_require_auth)) -> dict:
    del current_user
    return {"rooms": list_rooms()}


@app.post("/api/v1/rooms")
def create_communication_room(payload: RoomRequest, current_user: User = Depends(_require_auth)) -> dict:
    return {"message": "room created", "room": create_room(current_user.id, payload.name, payload.description)}


@app.post("/api/v1/rooms/{room_id}/join")
async def join_communication_room(room_id: int, current_user: User = Depends(_require_auth)) -> dict:
    try:
        room = join_room(current_user.id, room_id)
        await hub.send_room(room_id, {"type": "room_member_joined", "room_id": room_id, "user_id": current_user.id, "username": current_user.username})
        return {"message": "joined room", "room": room}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/api/v1/rooms/{room_id}/messages")
async def post_room_message(room_id: int, payload: MessageRequest, current_user: User = Depends(_require_auth)) -> dict:
    if payload.recipient_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="room messages must not include recipient_id")
    try:
        message = send_room_message(current_user.id, room_id, payload.content)
        await hub.send_room(room_id, {"type": "room_message", "data": message})
        return {"message": "room message sent", "data": message}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/api/v1/rooms/{room_id}/messages")
def get_room_messages_for_room(room_id: int, current_user: User = Depends(_require_auth)) -> dict:
    with session_scope() as session:
        membership = session.execute(select(RoomMember).where(
            RoomMember.room_id == room_id, RoomMember.user_id == current_user.id
        )).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="join the room to view its messages")
    try:
        return {"messages": get_room_messages(room_id)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


from backend.api.file_routes import router as file_router
app.include_router(file_router)
app.include_router(chat_router)
app.include_router(realtime_router)
