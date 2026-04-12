#!/usr/bin/env python3
"""
Seed script — run once to create the 3 initial users.
Usage: python3 create_users.py

Passwords are entered interactively (not echoed to terminal).
"""
import sqlite3
import getpass
from datetime import datetime, timezone
import bcrypt

DB_PATH = 'notes.db'

DEFAULT_CATEGORIES = [
    ("Tech / Experiments", "#60a5fa", 0),
    ("Music", "#a78bfa", 1),
    ("Books", "#34d399", 2),
    ("Personal / Philosophical", "#f472b6", 3),
    ("Productivity", "#facc15", 4),
    ("Gym / Health", "#fb923c", 5),
    ("Misc", "#71717a", 6),
]

USERS = [
    ("aardi",  "aardi — existing user, keep existing data"),
    ("alexag", "alexag — new user"),
    ("aaronr", "aaronr — new user"),
]


def create_user(cursor, username, password):
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        'INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
        (username, password_hash, now)
    )


def seed_categories(cursor, user_id):
    """Seed default categories for a user (skips if they already have categories)."""
    cursor.execute('SELECT COUNT(*) FROM categories WHERE user_id = ?', (user_id,))
    if cursor.fetchone()[0] > 0:
        print(f"  → Categories already exist for user_id={user_id}, skipping.")
        return
    cursor.executemany(
        'INSERT INTO categories (name, color, sort_order, user_id) VALUES (?, ?, ?, ?)',
        [(name, color, order, user_id) for name, color, order in DEFAULT_CATEGORIES]
    )
    print(f"  → Seeded {len(DEFAULT_CATEGORIES)} categories.")


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    for username, description in USERS:
        print(f"\n--- {description} ---")

        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        existing = cursor.fetchone()
        if existing:
            print(f"  User '{username}' already exists (id={existing[0]}). Skipping creation.")
            user_id = existing[0]
        else:
            password = getpass.getpass(f"  Password for {username}: ")
            confirm = getpass.getpass(f"  Confirm password: ")
            if password != confirm:
                print("  Passwords don't match — skipping this user.")
                continue
            if len(password) < 6:
                print("  Password too short (min 6 chars) — skipping.")
                continue
            create_user(cursor, username, password)
            cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
            user_id = cursor.fetchone()[0]
            print(f"  ✓ Created '{username}' (id={user_id})")

        seed_categories(cursor, user_id)

    conn.commit()

    # Verify aardi's user_id matches the DEFAULT 1 used in migration
    cursor.execute('SELECT id FROM users WHERE username = ?', ('aardi',))
    row = cursor.fetchone()
    if row and row[0] != 1:
        aardi_id = row[0]
        print(f"\n⚠  aardi has user_id={aardi_id} (not 1) — reassigning existing ideas and categories...")
        cursor.execute('UPDATE ideas SET user_id = ? WHERE user_id = 1', (aardi_id,))
        cursor.execute('UPDATE categories SET user_id = ? WHERE user_id = 1', (aardi_id,))
        conn.commit()
        print(f"  ✓ Reassigned to user_id={aardi_id}")

    conn.close()
    print("\n✓ Done.")
    cursor2 = sqlite3.connect(DB_PATH).cursor()
    cursor2.execute('SELECT id, username, created_at FROM users ORDER BY id')
    print("\nUsers in DB:")
    for row in cursor2.fetchall():
        print(f"  id={row[0]}  username={row[1]}  created={row[2]}")


if __name__ == '__main__':
    main()
