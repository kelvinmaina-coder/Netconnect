"""Authenticated metadata and transfer-history endpoints for TCP file sharing."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.security.auth_service import get_user_by_token
from backend.services.file_service import list_user_files, list_user_transfers

router = APIRouter(prefix="/api/v1/files", tags=["files"])
_bearer = HTTPBearer(auto_error=False)


def _current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    user = get_user_by_token(credentials.credentials)
    if user is None or user.is_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or suspended account")
    return user


@router.get("/tcp-info")
def tcp_transfer_info(user=Depends(_current_user)):
    del user
    return {
        "host": os.getenv("NETCONNECT_FILE_PUBLIC_HOST", os.getenv("NETCONNECT_FILE_TCP_HOST", "127.0.0.1")),
        "port": int(os.getenv("NETCONNECT_FILE_TCP_PORT", "9100")),
        "max_file_bytes": int(os.getenv("NETCONNECT_MAX_FILE_BYTES", str(10 * 1024 * 1024))),
        "protocol": "length-prefixed JSON control frames followed by raw TCP file bytes",
        "note": "The file TCP service must be running separately; use only on a trusted network until TLS is configured.",
    }


@router.get("")
def my_files(user=Depends(_current_user)):
    return {"files": list_user_files(user.id)}


@router.get("/transfers")
def my_transfers(user=Depends(_current_user)):
    return {"transfers": list_user_transfers(user.id)}
