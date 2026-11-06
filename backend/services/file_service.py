"""TCP file-transfer persistence helpers. File bytes never enter the database."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select

from backend.database import file_models as _file_models  # noqa: F401 - register tables with Base metadata
from backend.database.database import session_scope
from backend.database.file_models import FileRecord, FileTransfer


def list_user_files(user_id: int) -> list[dict]:
    with session_scope() as session:
        files = session.execute(
            select(FileRecord).where(FileRecord.owner_id == user_id).order_by(FileRecord.created_at.desc())
        ).scalars().all()
        return [serialize_file(item) for item in files]


def get_owned_file(user_id: int, file_id: int) -> dict | None:
    with session_scope() as session:
        item = session.execute(
            select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user_id)
        ).scalar_one_or_none()
        return serialize_file(item) if item else None


def get_owned_file_path(user_id: int, file_id: int, storage_dir: Path) -> tuple[dict, Path] | None:
    with session_scope() as session:
        item = session.execute(
            select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user_id)
        ).scalar_one_or_none()
        if item is None:
            return None
        root = storage_dir.resolve()
        path = (root / item.stored_name).resolve()
        if path.parent != root or not path.is_file():
            return None
        return serialize_file(item), path


def record_completed_upload(user_id: int, original_name: str, stored_name: str, size_bytes: int, sha256: str) -> dict:
    from datetime import datetime, timezone

    with session_scope() as session:
        record = FileRecord(
            owner_id=user_id,
            original_name=original_name,
            stored_name=stored_name,
            size_bytes=size_bytes,
            sha256=sha256,
        )
        session.add(record)
        session.flush()
        session.add(FileTransfer(
            user_id=user_id,
            file_id=record.id,
            direction="upload",
            status="completed",
            filename=original_name,
            size_bytes=size_bytes,
            sha256=sha256,
            completed_at=datetime.now(timezone.utc),
        ))
        session.flush()
        return serialize_file(record)


def record_download(user_id: int, file_id: int, filename: str, size_bytes: int, sha256: str) -> None:
    from datetime import datetime, timezone

    with session_scope() as session:
        session.add(FileTransfer(
            user_id=user_id,
            file_id=file_id,
            direction="download",
            status="completed",
            filename=filename,
            size_bytes=size_bytes,
            sha256=sha256,
            completed_at=datetime.now(timezone.utc),
        ))


def record_failed_transfer(user_id: int, direction: str, filename: str, size_bytes: int = 0) -> None:
    with session_scope() as session:
        session.add(FileTransfer(
            user_id=user_id,
            direction=direction,
            status="failed",
            filename=filename[:255] or "unknown",
            size_bytes=max(0, size_bytes),
        ))


def list_user_transfers(user_id: int) -> list[dict]:
    with session_scope() as session:
        transfers = session.execute(
            select(FileTransfer).where(FileTransfer.user_id == user_id).order_by(FileTransfer.created_at.desc()).limit(100)
        ).scalars().all()
        return [{
            "id": item.id,
            "file_id": item.file_id,
            "direction": item.direction,
            "status": item.status,
            "filename": item.filename,
            "size_bytes": item.size_bytes,
            "sha256": item.sha256,
            "created_at": item.created_at.isoformat(),
            "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        } for item in transfers]


def serialize_file(item: FileRecord) -> dict:
    return {
        "id": item.id,
        "name": item.original_name,
        "size_bytes": item.size_bytes,
        "sha256": item.sha256,
        "content_type": item.content_type,
        "created_at": item.created_at.isoformat(),
    }
