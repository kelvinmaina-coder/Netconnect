"""Authenticated WebSocket event delivery for browser clients.

WebSockets are a browser event bridge only. The standalone threaded TCP server
remains the application's TCP networking server.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.security.auth_service import get_user_by_token

router = APIRouter(tags=["realtime"])


class RealtimeHub:
    """Keep per-user sockets and room subscriptions on the ASGI event loop."""

    def __init__(self) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._room_subscriptions: dict[WebSocket, set[int]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._sockets[user_id].add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._sockets[user_id].discard(websocket)
            if not self._sockets[user_id]:
                self._sockets.pop(user_id, None)
            self._room_subscriptions.pop(websocket, None)

    async def subscribe_room(self, websocket: WebSocket, room_id: int) -> None:
        async with self._lock:
            self._room_subscriptions[websocket].add(room_id)

    async def send_users(self, user_ids: set[int], event: dict[str, Any]) -> None:
        async with self._lock:
            targets = [socket for user_id in user_ids for socket in self._sockets.get(user_id, set())]
        await self._send_many(targets, event)

    async def send_room(self, room_id: int, event: dict[str, Any]) -> None:
        async with self._lock:
            targets = [socket for socket, rooms in self._room_subscriptions.items() if room_id in rooms]
        await self._send_many(targets, event)

    async def _send_many(self, sockets: list[WebSocket], event: dict[str, Any]) -> None:
        for socket in sockets:
            try:
                await socket.send_json(event)
            except (RuntimeError, WebSocketDisconnect):
                # The connection handler will clean up the socket on disconnect.
                continue


hub = RealtimeHub()


@router.websocket("/api/v1/ws")
async def realtime_socket(websocket: WebSocket, token: str = "") -> None:
    """Authenticate via short-lived API token and accept room subscriptions."""
    user = get_user_by_token(token) if token else None
    if user is None or user.is_suspended:
        await websocket.close(code=1008, reason="authentication required")
        return

    await hub.connect(user.id, websocket)
    try:
        await websocket.send_json({"type": "connected", "user_id": user.id})
        while True:
            event = await websocket.receive_json()
            if not isinstance(event, dict):
                await websocket.send_json({"type": "error", "detail": "event must be a JSON object"})
                continue
            if event.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif event.get("type") == "subscribe_room":
                room_id = event.get("room_id")
                if isinstance(room_id, int) and not isinstance(room_id, bool) and room_id > 0:
                    from sqlalchemy import select
                    from backend.database.database import session_scope
                    from backend.database.models import RoomMember

                    with session_scope() as session:
                        membership = session.execute(select(RoomMember).where(
                            RoomMember.room_id == room_id, RoomMember.user_id == user.id
                        )).scalar_one_or_none()
                    if membership is None:
                        await websocket.send_json({"type": "error", "detail": "join the room before subscribing"})
                    else:
                        await hub.subscribe_room(websocket, room_id)
                        await websocket.send_json({"type": "subscribed", "room_id": room_id})
                else:
                    await websocket.send_json({"type": "error", "detail": "room_id must be a positive integer"})
            else:
                await websocket.send_json({"type": "error", "detail": "unsupported event type"})
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(user.id, websocket)
