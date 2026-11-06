"""Initialize the configured SQLite database: python -m backend.database.init_db"""
from backend.database.database import initialize_database


if __name__ == "__main__":
    initialize_database()
    print("NetConnect database initialized.")
