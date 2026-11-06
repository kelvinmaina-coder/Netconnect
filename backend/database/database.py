"""Thread-local SQLAlchemy sessions and SQLite engine configuration."""
import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from backend.database.models import Base


def database_url() -> str:
    return os.getenv("NETCONNECT_DB_URL", "sqlite:///./netconnect.db")


def make_engine(url: str | None = None):
    """Create an engine; SQLite connections are not shared across threads."""
    target = url or database_url()
    options = {"check_same_thread": False} if target.startswith("sqlite:") else {}
    engine = create_engine(target, connect_args=options, future=True)

    if target.startswith("sqlite:"):
        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


_engine = None
_SessionLocal = None


def configure_database(url: str | None = None):
    """Configure the module-level engine (useful for tests and initialization)."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = make_engine(url)
    _SessionLocal = sessionmaker(bind=_engine, class_=Session, expire_on_commit=False)
    return _engine


def get_engine():
    global _engine
    if _engine is None:
        configure_database()
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Yield a fresh session per operation and always close it."""
    factory = _SessionLocal
    if factory is None:
        configure_database()
        factory = _SessionLocal
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_database(url: str | None = None) -> None:
    """Create tables and seed the non-privileged default roles."""
    engine = configure_database(url) if url is not None or _engine is None else _engine
    Base.metadata.create_all(engine)
    from backend.database.models import Role

    with session_scope() as session:
        for role_name in ("administrator", "user"):
            if session.query(Role).filter_by(name=role_name).first() is None:
                session.add(Role(name=role_name))
