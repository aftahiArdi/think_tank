#!/usr/bin/env python3
"""
Seed script — create one or more users interactively.
Usage: python3 create_users.py

Run as many times as you like; existing users are detected and skipped.
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


def create_user(cursor, username, password):
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        'INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
        (username, password_hash, now)
    )


def seed_categories(cursor, user_id):
    cursor.execute('SELECT COUNT(*) FROM categories WHERE user_id = ?', (user_id,))
    if cursor.fetchone()[0] > 0:
        print(f"  → Categories already exist for user_id={user_id}, skipping.")
        return
    cursor.executemany(
        'INSERT INTO categories (name, color, sort_order, user_id) VALUES (?, ?, ?, ?)',
        [(name, color, order, user_id) for name, color, order in DEFAULT_CATEGORIES]
    )
    print(f"  → Seeded {len(DEFAULT_CATEGORIES)} default categories.")


def prompt_user(cursor):
    username = input("  Username: ").strip()
    if not username:
        print("  Username cannot be empty — skipping.")
        return

    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    existing = cursor.fetchone()
    if existing:
        print(f"  User '{username}' already exists (id={existing[0]}). Skipping.")
        seed_categories(cursor, existing[0])
        return

    password = getpass.getpass(f"  Password for {username}: ")
    confirm = getpass.getpass(f"  Confirm password: ")
    if password != confirm:
        print("  Passwords don't match — skipping.")
        return
    if len(password) < 6:
        print("  Password too short (min 6 chars) — skipping.")
        return

    create_user(cursor, username, password)
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    user_id = cursor.fetchone()[0]
    print(f"  ✓ Created '{username}' (id={user_id})")
    seed_categories(cursor, user_id)


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("Think Tank — user setup")
    print("Enter usernames one at a time. Leave blank and press Enter when done.\n")

    while True:
        print("--- New user (or press Enter to finish) ---")
        username_peek = input("  Username (blank to stop): ").strip()
        if not username_peek:
            break

        cursor.execute('SELECT id FROM users WHERE username = ?', (username_peek,))
        existing = cursor.fetchone()
        if existing:
            print(f"  User '{username_peek}' already exists (id={existing[0]}). Skipping creation.")
            seed_categories(cursor, existing[0])
        else:
            password = getpass.getpass(f"  Password for {username_peek}: ")
            confirm = getpass.getpass(f"  Confirm password: ")
            if password != confirm:
                print("  Passwords don't match — skipping.")
                continue
            if len(password) < 6:
                print("  Password too short (min 6 chars) — skipping.")
                continue

            create_user(cursor, username_peek, password)
            cursor.execute('SELECT id FROM users WHERE username = ?', (username_peek,))
            user_id = cursor.fetchone()[0]
            print(f"  ✓ Created '{username_peek}' (id={user_id})")
            seed_categories(cursor, user_id)

        print()

    conn.commit()
    conn.close()

    conn2 = sqlite3.connect(DB_PATH)
    cursor2 = conn2.cursor()
    cursor2.execute('SELECT id, username, created_at FROM users ORDER BY id')
    rows = cursor2.fetchall()
    conn2.close()

    print("\nUsers in DB:")
    for row in rows:
        print(f"  id={row[0]}  username={row[1]}  created={row[2]}")
    print("\n✓ Done.")


if __name__ == '__main__':
    main()
