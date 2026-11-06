"""Authentication services for user registration, login, logout, and RBAC."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend.database.database import session_scope
from backend.database.models import AuthenticationLog, Role, User, UserProfile, UserSession
from backend.security.passwords import hash_password, verify_password


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _user_to_public_dict(user: User) -> dict:
    role_name = user.role.name if getattr(user, "role", None) is not None else "user"
    return {
        "id": user.id,
        "username": user.username,
        "role": role_name,
        "status": user.status,
        "is_suspended": bool(user.is_suspended),
        "created_at": user.created_at.isoformat(),
    }


def ensure_default_admin(username: str = "admin", password: str = "Admin@12345") -> dict:
    """Create the initial administrator account if it does not exist."""
    with session_scope() as session:
        existing = session.execute(select(User).where(User.username == username.lower())).scalar_one_or_none()
        if existing is not None:
            return _user_to_public_dict(existing)
        role = session.execute(select(Role).where(Role.name == "administrator")).scalar_one_or_none()
        if role is None:
            role = Role(name="administrator")
            session.add(role)
            session.flush()
        user = User(
            username=username.lower(),
            password_hash=hash_password(password),
            role_id=role.id,
            status="active",
            is_suspended=False,
        )
        session.add(user)
        session.flush()
        session.add(UserProfile(user_id=user.id, full_name="System Administrator"))
        session.add(AuthenticationLog(user_id=user.id, event="bootstrap_admin", success=True, details="Initial administrator account created.", ip_address="system"))
        session.flush()
        return _user_to_public_dict(user)


def register_user(username: str, password: str, role_name: str = "user") -> dict:
    """Create a new application user."""
    cleaned_username = (username or "").strip()
    if len(cleaned_username) < 3:
        raise ValueError("username must contain at least 3 characters")
    if len(password or "") < 8:
        raise ValueError("password must be at least 8 characters long")
    if not cleaned_username.replace("_", "").isalnum():
        raise ValueError("username may only contain letters, numbers, and underscores")

    with session_scope() as session:
        existing_user = session.execute(select(User).where(User.username == cleaned_username.lower())).scalar_one_or_none()
        if existing_user is not None:
            raise ValueError("username already exists")
        role = session.execute(select(Role).where(Role.name == role_name)).scalar_one_or_none()
        if role is None:
            role = Role(name=role_name)
            session.add(role)
            session.flush()
        user = User(
            username=cleaned_username.lower(),
            password_hash=hash_password(password),
            role_id=role.id,
            status="active",
            is_suspended=False,
        )
        session.add(user)
        session.flush()
        session.add(UserProfile(user_id=user.id, full_name=cleaned_username))
        session.flush()
        session.add(AuthenticationLog(user_id=user.id, event="registered", success=True, details="User account created.", ip_address="system"))
        session.flush()
        return _user_to_public_dict(user)


def authenticate_user(username: str, password: str, ip_address: str | None = None) -> tuple[dict, str]:
    """Validate a username/password pair and issue a new API token."""
    cleaned_username = (username or "").strip().lower()
    if not cleaned_username or not password:
        raise PermissionError("username and password are required")
    with session_scope() as session:
        user = session.execute(select(User).where(User.username == cleaned_username)).scalar_one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            session.add(AuthenticationLog(user_id=user.id if user else None, event="login_failed", success=False, ip_address=ip_address, details="Invalid username or password"))
            raise PermissionError("invalid username or password")
        if user.is_suspended:
            session.add(AuthenticationLog(user_id=user.id, event="login_failed", success=False, ip_address=ip_address, details="Suspended account attempted login"))
            raise PermissionError("account is suspended")
        token = secrets.token_urlsafe(32)
        expires_at = utc_now() + timedelta(days=7)
        session.add(UserSession(user_id=user.id, token=token, expires_at=expires_at))
        user.last_seen = utc_now()
        session.add(AuthenticationLog(user_id=user.id, event="login", success=True, ip_address=ip_address, details="Successful login"))
        session.flush()
        return _user_to_public_dict(user), token


def get_user_by_token(token: str) -> User | None:
    with session_scope() as session:
        session_record = session.execute(
            select(UserSession)
            .options(joinedload(UserSession.user).joinedload(User.role))
            .where(UserSession.token == token)
            .where(UserSession.revoked_at.is_(None))
            .where(UserSession.expires_at > utc_now())
        ).scalar_one_or_none()
        if session_record is None:
            return None
        user = session_record.user
        if user is None:
            return None
        user.last_seen = utc_now()
        return user


def logout_user(token: str) -> bool:
    with session_scope() as session:
        session_record = session.execute(select(UserSession).where(UserSession.token == token)).scalar_one_or_none()
        if session_record is None:
            return False
        session_record.revoked_at = utc_now()
        return True


def list_users() -> list[dict]:
    with session_scope() as session:
        users = session.execute(select(User).order_by(User.created_at.desc())).scalars().all()
        return [_user_to_public_dict(user) for user in users]


def update_user_suspension(user_id: int, suspended: bool) -> dict:
    with session_scope() as session:
        user = session.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
        if user is None:
            raise ValueError("user not found")
        user.is_suspended = bool(suspended)
        user.status = "suspended" if suspended else "active"
        session.add(AuthenticationLog(user_id=user.id, event="suspension_changed", success=True, details=f"suspended={bool(suspended)}"))
        return _user_to_public_dict(user)


def get_user_by_id(user_id: int) -> User | None:
    with session_scope() as session:
        return session.execute(select(User).options(joinedload(User.role)).where(User.id == user_id)).scalar_one_or_none()
