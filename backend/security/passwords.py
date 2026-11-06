"""Password hashing and verification helpers.

Use bcrypt for secure password storage. The application stores only the hash,
never the raw password text in the database.
"""
import bcrypt


def hash_password(password: str) -> str:
    if not isinstance(password, str) or not password:
        raise ValueError("password must be a non-empty string")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(password_hash, str):
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False
