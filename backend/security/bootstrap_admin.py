"""Bootstrap the initial admin user from the command line."""
from backend.security.auth_service import ensure_default_admin


if __name__ == "__main__":
    admin = ensure_default_admin()
    print(f"Initial administrator account ready: {admin['username']}")
    print("Login with the default password: Admin@12345")
