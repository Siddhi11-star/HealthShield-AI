#!/usr/bin/env python3
"""
Initialize MediGuard AI database tables and seed initial data.
Run this once after setting up MySQL and .env.
"""

import sys
from config import get_db
from app import ensure_tables

def main():
    print("Connecting to database...")
    try:
        db = get_db()
        print("Connection successful.")
    except Exception as e:
        print(f"❌ Failed to connect: {e}")
        sys.exit(1)

    print("Creating/verifying tables and seeding default data...")
    try:
        ensure_tables(db)
        print("✅ Tables created/verified successfully.")
    except Exception as e:
        print(f"❌ Error during table creation: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()