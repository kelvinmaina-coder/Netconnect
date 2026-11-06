"""Messaging and room service for NetConnect milestones 3 and beyond."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from backend.database.database import session_scope
from backend.database.models import CommunicationRoom, Conversation, Message, Notification, RoomMember, User


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_room(created_by_user_id: int, name: str, description: str | None = None) -> dict:
    cleaned_name = (name or "").strip()
    if len(cleaned_name) < 3:
        raise ValueError("room name must be at least 3 characters long")
    with session_scope() as session:
        room = CommunicationRoom(name=cleaned_name, description=description or "", created_by_user_id=created_by_user_id)
        session.add(room)
        session.flush()
        member = RoomMember(room_id=room.id, user_id=created_by_user_id, is_admin=True)
        session.add(member)
        session.flush()
        return {
            "id": room.id,
            "name": room.name,
            "description": room.description,
            "created_by_user_id": room.created_by_user_id,
            "member_count": 1,
        }


def join_room(user_id: int, room_id: int) -> dict:
    with session_scope() as session:
        room = session.execute(select(CommunicationRoom).where(CommunicationRoom.id == room_id)).scalar_one_or_none()
        if room is None:
            raise ValueError("room not found")
        if session.execute(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.user_id == user_id)).scalar_one_or_none() is not None:
            return {"id": room.id, "name": room.name, "description": room.description}
        session.add(RoomMember(room_id=room_id, user_id=user_id, is_admin=False))
        session.flush()
        return {"id": room.id, "name": room.name, "description": room.description}


def list_rooms() -> list[dict]:
    with session_scope() as session:
        rooms = session.execute(select(CommunicationRoom).order_by(CommunicationRoom.created_at.desc())).scalars().all()
        result = []
        for room in rooms:
            result.append({
                "id": room.id,
                "name": room.name,
                "description": room.description,
                "member_count": len(room.members),
                "created_by_user_id": room.created_by_user_id,
            })
        return result


def send_private_message(sender_id: int, recipient_id: int, content: str) -> dict:
    if sender_id == recipient_id:
        raise ValueError("sender and recipient must be different users")
    cleaned = (content or "").strip()
    if not cleaned:
        raise ValueError("message content cannot be empty")
    with session_scope() as session:
        sender = session.execute(select(User).where(User.id == sender_id)).scalar_one_or_none()
        recipient = session.execute(select(User).where(User.id == recipient_id)).scalar_one_or_none()
        if sender is None or recipient is None:
            raise ValueError("sender or recipient not found")
        conversation = session.execute(
            select(Conversation).where(
                ((Conversation.user_one_id == sender_id) & (Conversation.user_two_id == recipient_id)) |
                ((Conversation.user_one_id == recipient_id) & (Conversation.user_two_id == sender_id))
            )
        ).scalar_one_or_none()
        if conversation is None:
            conversation = Conversation(user_one_id=sender_id, user_two_id=recipient_id)
            session.add(conversation)
            session.flush()
        message = Message(sender_id=sender_id, receiver_id=recipient_id, conversation_id=conversation.id, content=cleaned, message_type="text")
        session.add(message)
        session.flush()
        session.add(Notification(user_id=recipient_id, kind="message", message=f"New private message from {sender.username}"))
        return {
            "id": message.id,
            "sender_id": sender_id,
            "receiver_id": recipient_id,
            "conversation_id": conversation.id,
            "content": cleaned,
            "created_at": message.created_at.isoformat(),
        }


def get_user_conversations(user_id: int) -> list[dict]:
    with session_scope() as session:
        conversations = session.execute(
            select(Conversation)
            .where((Conversation.user_one_id == user_id) | (Conversation.user_two_id == user_id))
            .order_by(Conversation.created_at.desc())
        ).scalars().all()
        result = []
        for conversation in conversations:
            other_user_id = conversation.user_two_id if conversation.user_one_id == user_id else conversation.user_one_id
            other_user = session.execute(select(User).where(User.id == other_user_id)).scalar_one_or_none()
            result.append({
                "conversation_id": conversation.id,
                "other_user_id": other_user_id,
                "other_user": other_user.username if other_user else None,
                "message_count": len(conversation.messages),
            })
        return result


def send_room_message(sender_id: int, room_id: int, content: str) -> dict:
    cleaned = (content or "").strip()
    if not cleaned:
        raise ValueError("message content cannot be empty")
    with session_scope() as session:
        room = session.execute(select(CommunicationRoom).where(CommunicationRoom.id == room_id)).scalar_one_or_none()
        if room is None:
            raise ValueError("room not found")
        member = session.execute(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.user_id == sender_id)).scalar_one_or_none()
        if member is None:
            raise ValueError("user is not a member of this room")
        message = Message(sender_id=sender_id, room_id=room_id, content=cleaned, message_type="text")
        session.add(message)
        session.flush()
        for room_member in room.members:
            if room_member.user_id != sender_id:
                session.add(Notification(user_id=room_member.user_id, kind="room_message", message=f"New room message in {room.name}"))
        return {
            "id": message.id,
            "sender_id": sender_id,
            "room_id": room_id,
            "content": cleaned,
            "created_at": message.created_at.isoformat(),
        }


def get_room_messages(room_id: int) -> list[dict]:
    with session_scope() as session:
        room = session.execute(select(CommunicationRoom).where(CommunicationRoom.id == room_id)).scalar_one_or_none()
        if room is None:
            raise ValueError("room not found")
        result = []
        for message in room.messages:
            result.append({
                "id": message.id,
                "sender_id": message.sender_id,
                "content": message.content,
                "created_at": message.created_at.isoformat(),
            })
        return result
