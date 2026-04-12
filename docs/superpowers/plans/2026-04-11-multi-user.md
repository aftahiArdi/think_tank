# Multi-User Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 manually-created users (`aardi`, `alexag`, `aaronr`) with isolated ideas, categories, and uploads. No registration flow. No NextAuth — upgrades the existing HMAC cookie to carry username.

**Architecture:** Username is HMAC-signed into the auth cookie at login. Next.js middleware verifies the cookie and injects `X-Think-Tank-User: <username>` into the request before it reaches the Flask proxy route, which forwards it to Flask. All Flask endpoints filter data by `user_id` looked up from that header. Biometric gate is unchanged — it only gates the PWA session, not user identity.

**Tech Stack:** Flask + bcrypt, SQLite migrations (inline in `init_db`), Next.js middleware (Web Crypto API), no new frontend dependencies.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `requirements.txt` | Modify | Add `bcrypt==4.3.0` |
| `app.py` | Modify | `users` table, `user_id` migrations, `get_user_id()` helper, `/auth/login` endpoint, user-filtered queries on all ideas/categories endpoints |
| `create_users.py` | Create | One-shot seed script — creates 3 users with bcrypt passwords, seeds categories for alexag/aaronr |
| `frontend/proxy.ts` | Modify | `verifyToken` returns `username\|null`; injects `x-think-tank-user` into request headers for downstream handlers |
| `frontend/app/api/auth/route.ts` | Modify | Accept username + password; call Flask `/auth/login`; encode `username.hmac` cookie |
| `frontend/app/api/flask/[...path]/route.ts` | Modify | Forward `x-think-tank-user` request header to Flask |
| `frontend/components/auth/password-gate.tsx` | Modify | Add username field above password field |

---

## Task 1: Add bcrypt to Flask dependencies

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add bcrypt**

```
flask==3.1.2
gunicorn==23.0.0
bcrypt==4.3.0
pillow>=10.0.0
python-dotenv==1.1.1
pytz==2025.2
tzdata==2025.2
```

- [ ] **Step 2: Verify it installs**

```bash
cd /home/ardi/Projects/think_tank
docker build -f Dockerfile.api -t think_tank-flask-test . 2>&1 | grep -E "(bcrypt|ERROR|Successfully)"
```

Expected: `Successfully built` with no ERROR lines.

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "deps: add bcrypt for user password hashing"
```

---

## Task 2: DB migration — users table + user_id columns

**Files:**
- Modify: `app.py` — `init_db()` function only

- [ ] **Step 1: Add users table and user_id migration to `init_db`**

Replace the `init_db` function in `app.py` with this version. The only additions are the `users` table CREATE and three migration blocks at the end:

```python
def init_db():
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()

    # Existing tables (unchanged)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ideas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            timestamp DATETIME
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS todo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            size TEXT DEFAULT 'small',
            timestamp DATETIME
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS completed_todo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            size TEXT DEFAULT 'small',
            timestamp DATETIME,
            completed_timestamp DATETIME
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT,
            embedding TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS idea_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            original_name TEXT,
            media_type TEXT NOT NULL,
            file_size INTEGER,
            created_at DATETIME NOT NULL
        )
    ''')

    # NEW: users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at DATETIME NOT NULL
        )
    ''')

    # Migrate ideas table: add columns if missing
    cursor.execute("PRAGMA table_info(ideas)")
    ideas_cols = [col[1] for col in cursor.fetchall()]

    if "embedding" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN embedding TEXT")
    if "media_type" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN media_type TEXT DEFAULT 'text'")
    if "has_media" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN has_media INTEGER DEFAULT 0")
    if "category_id" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN category_id INTEGER REFERENCES categories(id)")
    if "starred" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")
    if "user_id" not in ideas_cols:
        # Default 1 — existing rows belong to aardi (who will be user id 1)
        cursor.execute("ALTER TABLE ideas ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")

    # Migrate categories table
    cursor.execute("PRAGMA table_info(categories)")
    cat_cols = [col[1] for col in cursor.fetchall()]
    if "user_id" not in cat_cols:
        cursor.execute("ALTER TABLE categories ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")

    # Migrate todo tables (existing pattern)
    cursor.execute("PRAGMA table_info(todo)")
    todo_cols = [col[1] for col in cursor.fetchall()]
    if "size" not in todo_cols:
        cursor.execute("ALTER TABLE todo ADD COLUMN size TEXT DEFAULT 'small'")

    cursor.execute("PRAGMA table_info(completed_todo)")
    completed_cols = [col[1] for col in cursor.fetchall()]
    if "size" not in completed_cols:
        cursor.execute("ALTER TABLE completed_todo ADD COLUMN size TEXT DEFAULT 'small'")
    if "completed_timestamp" not in completed_cols:
        cursor.execute("ALTER TABLE completed_todo ADD COLUMN completed_timestamp DATETIME")

    # NOTE: Default category seeding removed — handled by create_users.py seed script

    conn.commit()
    conn.close()
```

Key changes from the original:
- Removed `UNIQUE` constraint from `categories.name` (different users can have same category name)
- Added `users` table CREATE
- Added `user_id` migration for both `ideas` and `categories` (DEFAULT 1 → existing data belongs to aardi)
- Removed the auto-seed of default categories (now done per-user in `create_users.py`)

- [ ] **Step 2: Verify migration runs without crashing**

```bash
cd /home/ardi/Projects/think_tank
python3 -c "from app import init_db; init_db(); print('OK')"
```

Expected: `OK` with no errors.

- [ ] **Step 3: Verify schema**

```bash
sqlite3 notes.db ".schema users" && sqlite3 notes.db "PRAGMA table_info(ideas)" | grep user_id && sqlite3 notes.db "PRAGMA table_info(categories)" | grep user_id
```

Expected output contains:
```
CREATE TABLE users (...)
4|user_id|INTEGER|1||1      ← or similar row showing user_id column exists in ideas
...|user_id|INTEGER|...     ← user_id column exists in categories
```

- [ ] **Step 4: Commit**

```bash
git add app.py
git commit -m "feat: add users table and user_id migration for ideas/categories"
```

---

## Task 3: Flask auth endpoint + user-filtered queries

**Files:**
- Modify: `app.py` — add imports, `get_user_id()` helper, `/auth/login` endpoint, update all ideas/categories endpoints

- [ ] **Step 1: Add bcrypt import and `get_user_id()` helper at the top of `app.py`**

After the existing imports, add:

```python
import threading
import bcrypt as _bcrypt

# In-memory cache: username → user_id (populated on first request per username)
_user_id_cache: dict[str, int] = {}

def get_user_id() -> int | None:
    """Read username from X-Think-Tank-User header, return user_id or None."""
    username = request.headers.get('X-Think-Tank-User', '').strip().lower()
    if not username:
        return None
    if username in _user_id_cache:
        return _user_id_cache[username]
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    user_id = row[0] if row else None
    if user_id:
        _user_id_cache[username] = user_id
    return user_id
```

Note: `threading` import may already be in the file — remove the duplicate if so.

- [ ] **Step 2: Add `/auth/login` endpoint**

Add this endpoint before the `if __name__ == '__main__':` block:

```python
@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip().lower()
    password = (data.get('password') or '')

    if not username or not password:
        return jsonify({'error': 'Missing username or password'}), 400

    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Invalid credentials'}), 401

    user_id, password_hash = row
    if not _bcrypt.checkpw(password.encode(), password_hash.encode()):
        return jsonify({'error': 'Invalid credentials'}), 401

    return jsonify({'username': username, 'user_id': user_id}), 200
```

- [ ] **Step 3: Update `list_ideas` to filter by user**

Replace the `list_ideas` function:

```python
@app.route('/ideas', methods=['GET'])
def list_ideas():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.user_id = ?
            ORDER BY i.timestamp DESC
        ''', (user_id,))
        ideas_rows = cursor.fetchall()

        cursor.execute(
            'SELECT id, idea_id, filename, original_name, media_type, file_size, created_at FROM idea_media WHERE idea_id IN (SELECT id FROM ideas WHERE user_id = ?)',
            (user_id,)
        )
        media_by_idea = {}
        for m in cursor.fetchall():
            media_by_idea.setdefault(m['idea_id'], []).append({
                'id': m['id'],
                'filename': m['filename'],
                'media_type': m['media_type'],
                'file_size': m['file_size'],
                'url': f"/api/flask/uploads/{m['filename']}"
            })

        ideas = []
        for row in ideas_rows:
            idea = {
                'id': row['id'],
                'content': row['content'],
                'timestamp': row['timestamp'],
                'media_type': row['media_type'] or 'text',
                'has_media': bool(row['has_media']),
                'starred': bool(row['starred']),
                'category': None,
                'media': media_by_idea.get(row['id'], [])
            }
            if row['category_id']:
                idea['category'] = {
                    'id': row['category_id'],
                    'name': row['category_name'],
                    'color': row['category_color']
                }
            ideas.append(idea)

        conn.close()
        return jsonify({'ideas': ideas, 'total': len(ideas)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 4: Update `create_idea` to stamp user_id**

Replace the `create_idea` function:

```python
@app.route('/ideas', methods=['POST'])
def create_idea():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    content = data.get('content', '')
    category_id = data.get('category_id')

    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            'INSERT INTO ideas (content, timestamp, category_id, user_id) VALUES (?, ?, ?, ?)',
            (content, vancouver_time, category_id, user_id)
        )
        idea_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': idea_id, 'message': 'Idea saved.'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 5: Update `get_idea` to check user ownership**

Replace the `get_idea` function:

```python
@app.route('/ideas/<int:idea_id>', methods=['GET'])
def get_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.id = ? AND i.user_id = ?
        ''', (idea_id, user_id))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404

        cursor.execute(
            'SELECT id, filename, original_name, media_type, file_size, created_at FROM idea_media WHERE idea_id = ?',
            (idea_id,)
        )
        media = [{
            'id': m['id'],
            'filename': m['filename'],
            'media_type': m['media_type'],
            'file_size': m['file_size'],
            'url': f"/api/flask/uploads/{m['filename']}"
        } for m in cursor.fetchall()]

        conn.close()
        return jsonify({
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 6: Update `update_idea` to check user ownership**

Replace the `update_idea` function:

```python
@app.route('/ideas/<int:idea_id>', methods=['PATCH'])
def update_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        updates = []
        values = []
        if 'content' in data:
            updates.append('content = ?')
            values.append(data['content'])
        if 'category_id' in data:
            updates.append('category_id = ?')
            values.append(data['category_id'])

        if not updates:
            conn.close()
            return jsonify({'error': 'No fields to update.'}), 400

        values.extend([idea_id, user_id])
        cursor.execute(f"UPDATE ideas SET {', '.join(updates)} WHERE id = ? AND user_id = ?", values)

        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404

        conn.commit()
        conn.close()
        return jsonify({'message': 'Idea updated.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 7: Update `delete_idea` to check user ownership**

Replace the `delete_idea` function:

```python
@app.route('/ideas/<int:idea_id>', methods=['DELETE'])
def delete_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM ideas WHERE id = ? AND user_id = ?', (idea_id, user_id))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404

        cursor.execute('SELECT filename FROM idea_media WHERE idea_id = ?', (idea_id,))
        media_files = [row[0] for row in cursor.fetchall()]

        cursor.execute('DELETE FROM idea_media WHERE idea_id = ?', (idea_id,))
        cursor.execute('DELETE FROM ideas WHERE id = ? AND user_id = ?', (idea_id, user_id))
        conn.commit()
        conn.close()

        for filename in media_files:
            filepath = os.path.join('uploads', filename)
            if os.path.exists(filepath):
                os.remove(filepath)

        return jsonify({'message': 'Idea deleted.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 8: Update `star_idea` to check user ownership**

Replace the `star_idea` function:

```python
@app.route('/ideas/<int:idea_id>/star', methods=['PATCH'])
def star_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    starred = bool(data.get('starred', False))
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('UPDATE ideas SET starred = ? WHERE id = ? AND user_id = ?', (int(starred), idea_id, user_id))
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404
        conn.commit()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.id = ?
        ''', (idea_id,))
        row = cursor.fetchone()
        cursor.execute(
            'SELECT id, filename, media_type, file_size FROM idea_media WHERE idea_id = ?',
            (idea_id,)
        )
        media = [{
            'id': m['id'],
            'filename': m['filename'],
            'media_type': m['media_type'],
            'file_size': m['file_size'],
            'url': f"/api/flask/uploads/{m['filename']}"
        } for m in cursor.fetchall()]
        conn.close()

        return jsonify({
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 9: Update `list_categories` to filter by user**

Replace the `list_categories` function:

```python
@app.route('/categories', methods=['GET'])
def list_categories():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, name, color, sort_order FROM categories WHERE user_id = ? ORDER BY sort_order',
            (user_id,)
        )
        categories = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'categories': categories}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 10: Update `create_category` to stamp user_id**

Replace the `create_category` function:

```python
@app.route('/categories', methods=['POST'])
def create_category():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    name = data.get('name', '').strip()
    color = data.get('color', '#71717a')

    if not name:
        return jsonify({'error': 'Name is required.'}), 400

    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        cursor.execute('SELECT MAX(sort_order) FROM categories WHERE user_id = ?', (user_id,))
        max_order = cursor.fetchone()[0] or 0

        cursor.execute(
            'INSERT INTO categories (name, color, sort_order, user_id) VALUES (?, ?, ?, ?)',
            (name, color, max_order + 1, user_id)
        )
        cat_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': cat_id, 'message': 'Category created.'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 11: Update `update_category` to check user ownership**

Replace the `update_category` function:

```python
@app.route('/categories/<int:cat_id>', methods=['PATCH'])
def update_category(cat_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        updates = []
        values = []
        if 'name' in data:
            updates.append('name = ?')
            values.append(data['name'])
        if 'color' in data:
            updates.append('color = ?')
            values.append(data['color'])

        if not updates:
            conn.close()
            return jsonify({'error': 'No fields to update.'}), 400

        values.extend([cat_id, user_id])
        cursor.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = ? AND user_id = ?", values)

        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Category not found.'}), 404

        conn.commit()
        conn.close()
        return jsonify({'message': 'Category updated.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 12: Update `delete_category` to check user ownership**

Replace the `delete_category` function:

```python
@app.route('/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        # Reassign ideas to user's "Misc" category
        cursor.execute("SELECT id FROM categories WHERE name = 'Misc' AND user_id = ?", (user_id,))
        misc_row = cursor.fetchone()
        misc_id = misc_row[0] if misc_row else None

        if misc_id:
            cursor.execute(
                'UPDATE ideas SET category_id = ? WHERE category_id = ? AND user_id = ?',
                (misc_id, cat_id, user_id)
            )

        cursor.execute('DELETE FROM categories WHERE id = ? AND user_id = ?', (cat_id, user_id))

        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Category not found.'}), 404

        conn.commit()
        conn.close()
        return jsonify({'message': 'Category deleted.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 13: Commit**

```bash
git add app.py
git commit -m "feat: add /auth/login endpoint and user-scoped data access to all Flask endpoints"
```

---

## Task 4: User seed script

**Files:**
- Create: `create_users.py`

- [ ] **Step 1: Create `create_users.py`**

```python
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
    return cursor.lastrowid or None


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

        # Check if user already exists
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
            create_user(cursor, username, password)
            cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
            user_id = cursor.fetchone()[0]
            print(f"  ✓ Created '{username}' (id={user_id})")

        seed_categories(cursor, user_id)

    conn.commit()
    conn.close()
    print("\n✓ Done. All users created.")
    print("\nNOTE: Existing ideas/categories are already assigned to aardi (DEFAULT 1 in migration).")
    print("If aardi's user_id is not 1, run:")
    print("  sqlite3 notes.db 'UPDATE ideas SET user_id=(SELECT id FROM users WHERE username=\"aardi\") WHERE user_id=1;'")
    print("  sqlite3 notes.db 'UPDATE categories SET user_id=(SELECT id FROM users WHERE username=\"aardi\") WHERE user_id=1;'")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run the seed script**

```bash
cd /home/ardi/Projects/think_tank
python3 create_users.py
```

Enter passwords for each user when prompted. Then verify:

```bash
sqlite3 notes.db "SELECT id, username, created_at FROM users;"
sqlite3 notes.db "SELECT COUNT(*) FROM categories WHERE user_id=1;"
sqlite3 notes.db "SELECT COUNT(*) FROM categories WHERE user_id=2;"
sqlite3 notes.db "SELECT COUNT(*) FROM categories WHERE user_id=3;"
```

Expected: 3 rows in users, 7 categories per user (21 total for new users + existing for aardi).

Also verify aardi's ideas are still there:
```bash
sqlite3 notes.db "SELECT COUNT(*) FROM ideas WHERE user_id=1;"
```

- [ ] **Step 3: Fix aardi's user_id if needed**

After running the seed script, check aardi's actual user ID:

```bash
sqlite3 notes.db "SELECT id FROM users WHERE username='aardi';"
```

If the result is `1`, you're done. If it's anything else (e.g. `3` because the INSERT ORDER was different), run:

```bash
AARDI_ID=$(sqlite3 notes.db "SELECT id FROM users WHERE username='aardi';")
sqlite3 notes.db "UPDATE ideas SET user_id=$AARDI_ID WHERE user_id=1;"
sqlite3 notes.db "UPDATE categories SET user_id=$AARDI_ID WHERE user_id=1;"
echo "Reassigned to user_id=$AARDI_ID"
```

- [ ] **Step 4: Commit**

```bash
git add create_users.py
git commit -m "feat: add create_users.py seed script for initial 3 users"
```

---

## Task 5: Update Next.js middleware to extract username from cookie

**Files:**
- Modify: `frontend/proxy.ts`

The cookie format changes from `<timestamp>.<hmac_of_timestamp>` to `<username>.<hmac_of_username>`. The middleware now returns the username (or `null`) and injects it into request headers.

- [ ] **Step 1: Replace `frontend/proxy.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";

/**
 * Verify the auth cookie and extract the username.
 * Cookie format: "<username>.<hmac_hex_of_username>"
 * Returns the username if valid, null otherwise.
 */
async function verifyToken(token: string): Promise<string | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) return null;

  const username = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  if (!username) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === sig ? username : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/icon.svg" ||
    pathname.startsWith("/icon-") ||
    pathname === "/apple-touch-icon.png"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("think_tank_auth");
  const username = token ? await verifyToken(token.value) : null;

  if (!username) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Inject username into request headers — readable by /api/flask/[...path]/route.ts
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-think-tank-user", username);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Note: Removed `/api/flask` from the skip list — Flask proxy requests now go through the auth check so the username gets injected into their headers.

- [ ] **Step 2: Commit**

```bash
git add frontend/proxy.ts
git commit -m "feat: middleware extracts username from cookie and injects X-Think-Tank-User header"
```

---

## Task 6: Update auth route to issue username-bearing cookies

**Files:**
- Modify: `frontend/app/api/auth/route.ts`

- [ ] **Step 1: Replace `frontend/app/api/auth/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";
const API_URL = process.env.API_URL || "http://localhost:6000";

async function signUsername(username: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${username}.${sigHex}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!username || !password) {
    return NextResponse.json({ error: "Missing username or password" }, { status: 400 });
  }

  // Validate against Flask
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signUsername(username);

  (await cookies()).set("think_tank_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/api/auth/route.ts
git commit -m "feat: auth route accepts username+password, issues username-signed cookie"
```

---

## Task 7: Forward user header in Flask proxy

**Files:**
- Modify: `frontend/app/api/flask/[...path]/route.ts`

- [ ] **Step 1: Add user header forwarding**

In the `proxy` function, after the `content-type` header is set, add the user header:

```typescript
  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  // Forward the user identity injected by middleware
  const user = req.headers.get("x-think-tank-user");
  if (user) headers["x-think-tank-user"] = user;
```

The full updated `proxy` function in `frontend/app/api/flask/[...path]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import http from "node:http";

const BINARY_CONTENT_TYPE = /^(image|video|audio)\//;

async function proxy(req: NextRequest) {
  const apiUrl = process.env.API_URL || "http://localhost:6000";
  const path = req.nextUrl.pathname.replace(/^\/api\/flask/, "");
  const url = `${apiUrl}${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  // Forward user identity injected by middleware
  const user = req.headers.get("x-think-tank-user");
  if (user) headers["x-think-tank-user"] = user;

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? null
      : Buffer.from(await req.arrayBuffer());

  const parsed = new URL(url);

  return new Promise<Response>((resolve, reject) => {
    const upstream = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers,
      },
      (res) => {
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v && k !== "transfer-encoding") responseHeaders.set(k, String(v));
        }

        const contentType = (res.headers["content-type"] as string) || "";

        if (BINARY_CONTENT_TYPE.test(contentType)) {
          const stream = new ReadableStream({
            start(controller) {
              res.on("data", (chunk: Buffer) =>
                controller.enqueue(new Uint8Array(chunk))
              );
              res.on("end", () => controller.close());
              res.on("error", (err) => controller.error(err));
            },
          });
          resolve(
            new Response(stream, {
              status: res.statusCode || 500,
              headers: responseHeaders,
            })
          );
        } else {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve(
              new Response(new Uint8Array(Buffer.concat(chunks)), {
                status: res.statusCode || 500,
                headers: responseHeaders,
              })
            );
          });
        }

        res.on("error", reject);
      }
    );

    upstream.on("error", reject);
    if (body) upstream.write(body);
    upstream.end();
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/api/flask/[...path]/route.ts
git commit -m "feat: Flask proxy forwards X-Think-Tank-User header from middleware"
```

---

## Task 8: Update login UI (add username field)

**Files:**
- Modify: `frontend/components/auth/password-gate.tsx`

- [ ] **Step 1: Replace `frontend/components/auth/password-gate.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint } from "lucide-react";
import {
  isBiometricAvailable,
  isBiometricEnabled,
  registerBiometric,
} from "@/lib/biometric";

export function PasswordGate() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showBiometricSetup, setShowBiometricSetup] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const router = useRouter();

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });

    if (res.ok) {
      if (biometricAvailable && !isBiometricEnabled()) {
        setShowBiometricSetup(true);
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      setError("Invalid username or password");
      setPassword("");
    }
    setLoading(false);
  };

  const handleEnableBiometric = async () => {
    const ok = await registerBiometric();
    if (!ok) {
      setError("Face ID setup failed. You can enable it later in settings.");
    }
    router.push("/");
    router.refresh();
  };

  const handleSkipBiometric = () => {
    router.push("/");
    router.refresh();
  };

  if (showBiometricSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-xs space-y-6 text-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <Fingerprint size={40} style={{ color: "var(--primary)" }} />
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
              Enable Face ID?
            </h2>
            <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>
              Unlock Think Tank with Face ID instead of typing your password every time.
            </p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="space-y-2">
            <Button onClick={handleEnableBiometric} className="w-full">
              Enable Face ID
            </Button>
            <Button
              onClick={handleSkipBiometric}
              variant="ghost"
              className="w-full"
              style={{ color: "var(--muted-foreground)" }}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <h1
          className="text-2xl font-bold text-center"
          style={{ color: "var(--foreground)" }}
        >
          think tank
        </h1>
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          className="text-center"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="text-center"
        />
        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading || !username || !password}>
          {loading ? "..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/auth/password-gate.tsx
git commit -m "feat: login form accepts username + password"
```

---

## Task 9: Remove THINK_TANK_PASSWORD env var (cleanup)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env` (if it has THINK_TANK_PASSWORD)

- [ ] **Step 1: Remove from docker-compose.yml**

In the `nextjs` service environment section, remove:
```yaml
      - THINK_TANK_PASSWORD=${THINK_TANK_PASSWORD}
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: remove THINK_TANK_PASSWORD env var (auth now uses DB users)"
```

---

## Task 10: Rebuild and smoke test

- [ ] **Step 1: Rebuild both containers**

```bash
cd /home/ardi/Projects/think_tank
docker compose build --no-cache flask nextjs 2>&1 | tail -10
```

Expected: both images build successfully.

- [ ] **Step 2: Start containers**

```bash
docker compose up -d --force-recreate flask nextjs
sleep 5
docker logs think_tank_api --tail=10
docker logs think_tank_frontend --tail=10
```

Expected: both logs show startup without errors.

- [ ] **Step 3: Test Flask auth endpoint directly**

```bash
# Should succeed
curl -s -X POST http://localhost:6000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"aardi","password":"<aardi_password>"}' | python3 -m json.tool

# Should fail
curl -s -X POST http://localhost:6000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"aardi","password":"wrongpassword"}' | python3 -m json.tool
```

Expected: first returns `{"username": "aardi", "user_id": N}`, second returns `{"error": "Invalid credentials"}` with 401.

- [ ] **Step 4: Test ideas endpoint isolation**

```bash
# aardi's ideas (should return existing data)
curl -s http://localhost:6000/ideas \
  -H "X-Think-Tank-User: aardi" | python3 -m json.tool | grep '"total"'

# alexag's ideas (should be empty)
curl -s http://localhost:6000/ideas \
  -H "X-Think-Tank-User: alexag" | python3 -m json.tool | grep '"total"'

# No user header (should return 401)
curl -s -o /dev/null -w "%{http_code}" http://localhost:6000/ideas
```

Expected: aardi has N ideas (your existing count), alexag has 0, no-header returns 401.

- [ ] **Step 5: Browser smoke test**

Open http://localhost:3004 in browser. Should redirect to `/login`. Log in as `aardi` — should see your existing ideas. Log in as `alexag` — should see empty feed.

- [ ] **Step 6: Final commit if anything was tweaked**

```bash
git add -A
git status  # review what's uncommitted
git commit -m "feat: complete multi-user support — aardi, alexag, aaronr"
```
