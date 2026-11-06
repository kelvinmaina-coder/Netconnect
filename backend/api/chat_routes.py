"""Conversation history, message search, and user-owned notifications."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_, select

from backend.database.database import session_scope
from backend.database.models import Conversation, Message, Notification, User
from backend.security.auth_service import get_user_by_token

router = APIRouter(tags=["chat"])
_bearer = HTTPBearer(auto_error=False)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    user = get_user_by_token(credentials.credentials)
    if user is None or user.is_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or suspended account")
    return user


def _serialize_message(message: Message) -> dict:
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "receiver_id": message.receiver_id,
        "room_id": message.room_id,
        "conversation_id": message.conversation_id,
        "content": message.content,
        "message_type": message.message_type,
        "created_at": message.created_at.isoformat(),
    }


@router.get("/api/v1/messages/conversations/{conversation_id}/messages")
def conversation_history(
    conversation_id: int,
    user: User = Depends(current_user),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict:
    """Return history only to one of the conversation's two participants."""
    with session_scope() as session:
        conversation = session.execute(select(Conversation).where(
            Conversation.id == conversation_id,
            or_(Conversation.user_one_id == user.id, Conversation.user_two_id == user.id),
        )).scalar_one_or_none()
        if conversation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversation not found")
        messages = session.execute(select(Message).where(
            Message.conversation_id == conversation_id
        ).order_by(Message.created_at.asc(), Message.id.asc()).limit(limit)).scalars().all()
        return {"messages": [_serialize_message(message) for message in messages]}


@router.get("/api/v1/messages/search")
def search_messages(
    q: str = Query(min_length=1, max_length=100),
    user: User = Depends(current_user),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict:
    """Search only private messages in which the caller is a participant."""
    needle = f"%{q.strip()}%"
    if needle == "%%":
        return {"messages": []}
    with session_scope() as session:
        messages = session.execute(select(Message).where(
            Message.conversation_id.is_not(None),
            or_(Message.sender_id == user.id, Message.receiver_id == user.id),
            Message.content.ilike(needle),
        ).order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)).scalars().all()
        return {"messages": [_serialize_message(message) for message in messages]}


@router.get("/api/v1/notifications")
def my_notifications(
    user: User = Depends(current_user),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict:
    with session_scope() as session:
        items = session.execute(select(Notification).where(
            Notification.user_id == user.id
        ).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)).scalars().all()
        return {"notifications": [{
            "id": item.id, "kind": item.kind, "message": item.message,
            "is_read": item.is_read, "created_at": item.created_at.isoformat(),
        } for item in items]}
