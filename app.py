import sqlite3
import json
import os
import random
import re
import threading
import bcrypt as _bcrypt
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# OpenAI client for Whisper transcription. Imported lazily at module load so a
# missing API key doesn't crash the rest of the app — the /transcribe endpoint
# checks `_openai_client` before use and returns a clear error if unconfigured.
try:
    from openai import OpenAI as _OpenAI  # type: ignore
    _openai_key = os.environ.get("OPENAI_API_KEY")
    _openai_client = _OpenAI(api_key=_openai_key) if _openai_key else None
except Exception:
    _openai_client = None

# --- Timezone Setup ---
VANCOUVER_TZ = ZoneInfo("America/Vancouver")

# --- Database Setup ---
def init_db():
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()

    # Existing tables
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

    # categories: no UNIQUE on name — different users can share category names
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

    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at DATETIME NOT NULL
        )
    ''')

    # shared_feed table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shared_feed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            shared_at DATETIME NOT NULL,
            UNIQUE(idea_id)
        )
    ''')

    # feed_stars table: users saving/starring posts from others' feed
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS feed_stars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            starred_at DATETIME NOT NULL,
            UNIQUE(user_id, idea_id)
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

    # Migrate users table: add avatar_filename if missing
    cursor.execute("PRAGMA table_info(users)")
    user_cols = [r[1] for r in cursor.fetchall()]
    if "avatar_filename" not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar_filename TEXT")

    # Enable WAL mode for better concurrent read performance (persists in the DB file)
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA wal_autocheckpoint=1000")

    # Hot-path index for the paginated feed query (WHERE user_id = ? ORDER BY timestamp DESC).
    # Keeps cursor-paginated reads O(log n) regardless of history size.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_ideas_user_timestamp ON ideas(user_id, timestamp DESC)"
    )
    # Supporting indexes for feed JOINs — without these SQLite scans shared_feed/idea_media
    # on every page load of list_ideas.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_shared_feed_idea ON shared_feed(idea_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_idea_media_idea ON idea_media(idea_id)"
    )

    # Daily AI summaries — one row per (user, date). Cached forever so each day
    # only ever costs one LLM call; regeneration is explicit via ?force=1.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_summaries (
            user_id INTEGER NOT NULL REFERENCES users(id),
            date TEXT NOT NULL,
            content TEXT NOT NULL,
            idea_count INTEGER NOT NULL,
            model TEXT,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (user_id, date)
        )
    ''')

    # NOTE: Default category seeding removed — handled per-user by create_users.py

    conn.commit()
    conn.close()


# --- Flask App ---
init_db()
app = Flask(__name__)

# In-memory cache: username → user_id (populated on first request per username)
_user_id_cache: dict = {}


def get_conn():
    """Return a SQLite connection with performance-optimised settings."""
    conn = sqlite3.connect('notes.db')
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-16000")   # 16MB page cache per connection
    conn.execute("PRAGMA temp_store=MEMORY")   # temp tables in RAM
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_user_id():
    """Read username from X-Think-Tank-User header, return user_id or None."""
    username = request.headers.get('X-Think-Tank-User', '').strip().lower()
    if not username:
        return None
    if username in _user_id_cache:
        return _user_id_cache[username]
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    user_id = row[0] if row else None
    if user_id:
        _user_id_cache[username] = user_id
    return user_id


# --- Auth ---

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip().lower()
    password = (data.get('password') or '')

    if not username or not password:
        return jsonify({'error': 'Missing username or password'}), 400

    conn = get_conn()
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


# --- Legacy endpoints (iOS Shortcut / todo) ---

@app.route('/add_note', methods=['POST'])
def add_note():
    data = request.get_json()
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Content is required.'}), 400

    conn = get_conn()
    cursor = conn.cursor()
    vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute('INSERT INTO ideas (content, timestamp) VALUES (?, ?)', (content, vancouver_time))
    idea_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({'message': 'Note added successfully.', 'id': idea_id}), 201


@app.route('/add_todo', methods=['POST'])
def add_todo():
    data = request.get_json()
    content = data.get('content')
    size = data.get('size', 'small')

    if not content:
        return jsonify({'error': 'Content is required.'}), 400

    if size not in ('tiny', 'small', 'big', 'project'):
        size = 'small'

    conn = get_conn()
    cursor = conn.cursor()
    vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        'INSERT INTO todo (content, size, timestamp) VALUES (?, ?, ?)',
        (content, size, vancouver_time)
    )
    conn.commit()
    conn.close()

    return jsonify({'message': 'To-Do item added successfully.'}), 201


@app.route('/list_todos', methods=['GET'])
def list_todos():
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute('SELECT id, content, size, timestamp FROM todo')
    rows = cursor.fetchall()
    conn.close()

    now = datetime.now(VANCOUVER_TZ)
    todos = []
    for id, content, size, timestamp in rows:
        try:
            created = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=VANCOUVER_TZ)
            days_old = (now - created).days
        except Exception:
            days_old = 0
        todos.append({
            'id': id,
            'content': content,
            'size': size or 'small',
            'days_old': days_old,
        })

    size_weight = {'project': 4, 'big': 3, 'small': 2, 'tiny': 1}
    todos.sort(key=lambda t: (t['days_old'], size_weight.get(t['size'], 2)), reverse=True)

    return jsonify(todos), 200


@app.route('/complete_todo', methods=['POST'])
def complete_todo():
    data = request.get_json()
    todo_id = data.get('id')

    if not todo_id:
        return jsonify({'error': 'id is required.'}), 400

    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute('SELECT id, content, size, timestamp FROM todo WHERE id = ?', (todo_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Task not found.'}), 404

    id, content, size, timestamp = row
    completed_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute(
        'INSERT INTO completed_todo (id, content, size, timestamp, completed_timestamp) VALUES (?, ?, ?, ?, ?)',
        (id, content, size or 'small', timestamp, completed_timestamp)
    )
    cursor.execute('DELETE FROM todo WHERE id = ?', (todo_id,))
    conn.commit()
    conn.close()

    return jsonify({'message': f'Task "{content}" completed.'}), 200


@app.route('/delete_todo', methods=['POST'])
def delete_todo():
    data = request.get_json()
    todo_id = data.get('id')

    if not todo_id:
        return jsonify({'error': 'id is required.'}), 400

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM todo WHERE id = ?', (todo_id,))
    conn.commit()
    conn.close()

    return jsonify({'message': 'Task deleted.'}), 200


# --- Ideas API ---

ALLOWED_MIME_PREFIXES = ('image/', 'video/', 'audio/')
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE


def sanitize_filename(name):
    """Strip path separators and special chars, keep alphanumeric, hyphens, underscores, dots."""
    name = os.path.basename(name)
    name = re.sub(r'[^\w\-.]', '_', name)
    return name


@app.route('/ideas', methods=['GET'])
def list_ideas():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        # Cursor pagination: `before` is the timestamp of the last idea from the prior page.
        # Response payload stays constant-size regardless of total history length.
        before = request.args.get('before')
        try:
            limit = int(request.args.get('limit', 50))
        except (TypeError, ValueError):
            limit = 50
        limit = max(1, min(limit, 200))

        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        if before:
            cursor.execute('''
                SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                       c.name as category_name, c.color as category_color,
                       u.username as owner_username,
                       CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
                FROM ideas i
                LEFT JOIN categories c ON i.category_id = c.id
                LEFT JOIN users u ON i.user_id = u.id
                LEFT JOIN shared_feed sf ON sf.idea_id = i.id
                WHERE i.user_id = ? AND i.timestamp < ?
                ORDER BY i.timestamp DESC
                LIMIT ?
            ''', (user_id, before, limit))
        else:
            cursor.execute('''
                SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                       c.name as category_name, c.color as category_color,
                       u.username as owner_username,
                       CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
                FROM ideas i
                LEFT JOIN categories c ON i.category_id = c.id
                LEFT JOIN users u ON i.user_id = u.id
                LEFT JOIN shared_feed sf ON sf.idea_id = i.id
                WHERE i.user_id = ?
                ORDER BY i.timestamp DESC
                LIMIT ?
            ''', (user_id, limit))
        ideas_rows = cursor.fetchall()

        # Only fetch media for the ideas we're actually returning — avoids scanning
        # the full media table on every page.
        idea_ids = [row['id'] for row in ideas_rows]
        media_by_idea = {}
        if idea_ids:
            placeholders = ','.join('?' * len(idea_ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, original_name, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                idea_ids
            )
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
                'owner_username': row['owner_username'],
                'is_shared': bool(row['is_shared']),
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

        # next_before cursor = timestamp of the last row returned, or null if this is the tail.
        next_before = ideas[-1]['timestamp'] if len(ideas) == limit else None

        conn.close()
        return jsonify({'ideas': ideas, 'next_before': next_before}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/by-date', methods=['GET'])
def ideas_by_date():
    """Return all ideas (with media) for a single Vancouver-date, used by the
    Recap tab to expand a given day without pulling the whole feed."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    date_str = request.args.get('date', '').strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return jsonify({'error': 'Invalid date.'}), 400

    conn = get_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
               c.name as category_name, c.color as category_color,
               u.username as owner_username,
               CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
        FROM ideas i
        LEFT JOIN categories c ON i.category_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        LEFT JOIN shared_feed sf ON sf.idea_id = i.id
        WHERE i.user_id = ? AND i.timestamp LIKE ?
        ORDER BY i.timestamp ASC
    ''', (user_id, f'{date_str}%'))
    rows = cursor.fetchall()
    idea_ids = [r['id'] for r in rows]
    media_by_idea = {}
    if idea_ids:
        placeholders = ','.join('?' * len(idea_ids))
        cursor.execute(
            f'SELECT id, idea_id, filename, original_name, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
            idea_ids,
        )
        for m in cursor.fetchall():
            media_by_idea.setdefault(m['idea_id'], []).append({
                'id': m['id'],
                'filename': m['filename'],
                'media_type': m['media_type'],
                'file_size': m['file_size'],
                'url': f"/api/flask/uploads/{m['filename']}",
            })
    ideas = []
    for row in rows:
        idea = {
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),
            'owner_username': row['owner_username'],
            'is_shared': bool(row['is_shared']),
            'category': None,
            'media': media_by_idea.get(row['id'], []),
        }
        if row['category_id']:
            idea['category'] = {
                'id': row['category_id'],
                'name': row['category_name'],
                'color': row['category_color'],
            }
        ideas.append(idea)
    conn.close()
    return jsonify({'ideas': ideas}), 200


@app.route('/ideas/random', methods=['GET'])
def random_idea():
    """One random idea older than exclude_hours (default 24). Picked server-side so
    Flashback draws from the user's ENTIRE history, not just whatever the paginated
    feed happens to have loaded."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        try:
            exclude_hours = int(request.args.get('exclude_hours', 24))
        except (TypeError, ValueError):
            exclude_hours = 24

        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Avoid `ORDER BY RANDOM()` — it scans + sorts the whole table. Instead
        # count the eligible rows and pick a random offset; with the index on
        # (user_id, timestamp) this is effectively two indexed lookups.
        cursor.execute(
            """
            SELECT COUNT(*) FROM ideas
            WHERE user_id = ? AND timestamp < datetime('now', ?)
            """,
            (user_id, f'-{exclude_hours} hours'),
        )
        total = cursor.fetchone()[0]
        if not total:
            conn.close()
            return jsonify({'idea': None}), 200
        offset = random.randint(0, total - 1)
        cursor.execute(
            """
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.user_id = ?
              AND i.timestamp < datetime('now', ?)
            ORDER BY i.timestamp
            LIMIT 1 OFFSET ?
            """,
            (user_id, f'-{exclude_hours} hours', offset),
        )
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({'idea': None}), 200

        cursor.execute(
            'SELECT id, filename, media_type, file_size FROM idea_media WHERE idea_id = ?',
            (row['id'],),
        )
        media = [
            {
                'id': m['id'],
                'filename': m['filename'],
                'media_type': m['media_type'],
                'file_size': m['file_size'],
                'url': f"/api/flask/uploads/{m['filename']}",
            }
            for m in cursor.fetchall()
        ]
        conn.close()
        return jsonify({
            'idea': {
                'id': row['id'],
                'content': row['content'],
                'timestamp': row['timestamp'],
                'media_type': row['media_type'] or 'text',
                'has_media': bool(row['has_media']),
                'starred': bool(row['starred']),
                'owner_username': row['owner_username'],
                'is_shared': bool(row['is_shared']),
                'category': None,
                'media': media,
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/on-this-day', methods=['GET'])
def on_this_day():
    """Flashback ideas: exact month+day matches from prior years, plus one random
    idea from each prior week-ago bucket (same day-of-week, up to 52 weeks back).
    Server-side so Flashback reaches across the user's entire history regardless
    of pagination."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1) Exact month+day matches from prior years
        cursor.execute(
            """
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.user_id = ?
              AND strftime('%m-%d', i.timestamp) = strftime('%m-%d', 'now', 'localtime')
              AND date(i.timestamp) != date('now', 'localtime')
            ORDER BY i.timestamp DESC
            LIMIT 20
            """,
            (user_id,),
        )
        rows = list(cursor.fetchall())
        seen_ids = {r['id'] for r in rows}

        # 2) One random idea per prior week bucket (1..52 weeks ago) —
        #    matches the old client-side getFlashbackIdeas behavior.
        cursor.execute(
            """
            WITH ranked AS (
                SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred,
                       u.username as owner_username,
                       CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared,
                       CAST((julianday(date('now', 'localtime'))
                             - julianday(date(i.timestamp, 'localtime'))) / 7 AS INTEGER) AS weeks_ago,
                       ROW_NUMBER() OVER (
                           PARTITION BY CAST((julianday(date('now', 'localtime'))
                                              - julianday(date(i.timestamp, 'localtime'))) / 7 AS INTEGER)
                           ORDER BY RANDOM()
                       ) AS rn
                FROM ideas i
                LEFT JOIN users u ON i.user_id = u.id
                LEFT JOIN shared_feed sf ON sf.idea_id = i.id
                WHERE i.user_id = ?
                  AND date(i.timestamp, 'localtime') < date('now', 'localtime', '-6 days')
            )
            SELECT * FROM ranked
            WHERE rn = 1 AND weeks_ago BETWEEN 1 AND 52
            ORDER BY weeks_ago ASC
            """,
            (user_id,),
        )
        for r in cursor.fetchall():
            if r['id'] in seen_ids:
                continue
            seen_ids.add(r['id'])
            rows.append(r)

        ids = [r['id'] for r in rows]
        media_by_idea: dict[int, list] = {}
        if ids:
            placeholders = ','.join('?' * len(ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                ids,
            )
            for m in cursor.fetchall():
                media_by_idea.setdefault(m['idea_id'], []).append({
                    'id': m['id'],
                    'filename': m['filename'],
                    'media_type': m['media_type'],
                    'file_size': m['file_size'],
                    'url': f"/api/flask/uploads/{m['filename']}",
                })

        ideas = [
            {
                'id': r['id'],
                'content': r['content'],
                'timestamp': r['timestamp'],
                'media_type': r['media_type'] or 'text',
                'has_media': bool(r['has_media']),
                'starred': bool(r['starred']),
                'owner_username': r['owner_username'],
                'is_shared': bool(r['is_shared']),
                'category': None,
                'media': media_by_idea.get(r['id'], []),
            }
            for r in rows
        ]
        conn.close()
        return jsonify({'ideas': ideas}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/starred', methods=['GET'])
def starred_ideas():
    """Every starred idea for the user, regardless of pagination. Starred lists
    are typically small (<100) so we return the full set in one response."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.user_id = ? AND i.starred = 1
            ORDER BY i.timestamp DESC
            """,
            (user_id,),
        )
        rows = cursor.fetchall()

        ids = [r['id'] for r in rows]
        media_by_idea: dict[int, list] = {}
        if ids:
            placeholders = ','.join('?' * len(ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                ids,
            )
            for m in cursor.fetchall():
                media_by_idea.setdefault(m['idea_id'], []).append({
                    'id': m['id'],
                    'filename': m['filename'],
                    'media_type': m['media_type'],
                    'file_size': m['file_size'],
                    'url': f"/api/flask/uploads/{m['filename']}",
                })

        ideas = []
        for row in rows:
            idea = {
                'id': row['id'],
                'content': row['content'],
                'timestamp': row['timestamp'],
                'media_type': row['media_type'] or 'text',
                'has_media': bool(row['has_media']),
                'starred': True,
                'owner_username': row['owner_username'],
                'is_shared': bool(row['is_shared']),
                'category': None,
                'media': media_by_idea.get(row['id'], []),
            }
            if row['category_id']:
                idea['category'] = {
                    'id': row['category_id'],
                    'name': row['category_name'],
                    'color': row['category_color'],
                }
            ideas.append(idea)

        conn.close()
        return jsonify({'ideas': ideas}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/stats-data', methods=['GET'])
def stats_data():
    """Lightweight rows for every idea the user owns — just what StatsView needs
    to compute totals, streaks, heatmaps, and burst sessions. No media, no joins."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, content, timestamp, media_type
            FROM ideas
            WHERE user_id = ?
            ORDER BY timestamp DESC
            """,
            (user_id,),
        )
        ideas = [
            {
                'id': r['id'],
                'content': r['content'] or '',
                'timestamp': r['timestamp'],
                'media_type': r['media_type'] or 'text',
            }
            for r in cursor.fetchall()
        ]
        conn.close()
        return jsonify({'ideas': ideas}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas', methods=['POST'])
def create_idea():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    content = data.get('content', '')
    category_id = data.get('category_id')

    try:
        conn = get_conn()
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


@app.route('/ideas/<int:idea_id>', methods=['GET'])
def get_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.id = ? AND i.user_id = ?
        ''', (idea_id, user_id))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404

        cursor.execute(
            'SELECT id, filename, original_name, media_type, file_size FROM idea_media WHERE idea_id = ?',
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
            'owner_username': row['owner_username'],
            'is_shared': bool(row['is_shared']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/<int:idea_id>', methods=['PATCH'])
def update_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    try:
        conn = get_conn()
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


@app.route('/ideas/<int:idea_id>', methods=['DELETE'])
def delete_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
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


@app.route('/ideas/<int:idea_id>/star', methods=['PATCH'])
def star_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    starred = bool(data.get('starred', False))
    try:
        conn = get_conn()
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


@app.route('/search', methods=['POST'])
def semantic_search():
    return jsonify({'results': []}), 200


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided.'}), 400

    file = request.files['file']
    idea_id = request.form.get('idea_id')

    if not idea_id:
        return jsonify({'error': 'idea_id is required.'}), 400

    if not file.filename:
        return jsonify({'error': 'Empty filename.'}), 400

    import mimetypes
    content_type = file.content_type or ''
    if not content_type or content_type == 'application/octet-stream':
        guessed, _ = mimetypes.guess_type(file.filename)
        content_type = guessed or ''

    if not any(content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        return jsonify({'error': f'File type not allowed: {content_type or "unknown"}'}), 400

    user_id = get_user_id()
    username = request.headers.get('X-Think-Tank-User', 'unknown').strip().lower()

    try:
        sanitized = sanitize_filename(file.filename)
        stored_filename = f"{username}/{idea_id}_{sanitized}"
        filepath = os.path.join('uploads', stored_filename)

        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        file.save(filepath)
        file_size = os.path.getsize(filepath)

        if file.filename == 'sketch.png':
            media_type = 'sketch'
        elif content_type.startswith('image/'):
            media_type = 'image'
        elif content_type.startswith('audio/'):
            media_type = 'audio'
        else:
            media_type = 'video'

        conn = get_conn()
        cursor = conn.cursor()
        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute(
            'INSERT INTO idea_media (idea_id, filename, original_name, media_type, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (idea_id, stored_filename, file.filename, media_type, file_size, vancouver_time)
        )
        media_id = cursor.lastrowid

        cursor.execute('SELECT media_type FROM ideas WHERE id = ?', (idea_id,))
        row = cursor.fetchone()
        if row:
            current_type = row[0] or 'text'
            if current_type == 'text':
                new_type = media_type
            elif current_type != media_type:
                new_type = 'mixed'
            else:
                new_type = current_type
            cursor.execute(
                'UPDATE ideas SET media_type = ?, has_media = 1 WHERE id = ?',
                (new_type, idea_id)
            )

        conn.commit()
        conn.close()

        return jsonify({
            'id': media_id,
            'filename': stored_filename,
            'url': f'/api/flask/uploads/{stored_filename}'
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    if _openai_client is None:
        return jsonify({'error': 'Transcription not configured.'}), 503

    data = request.get_json(silent=True) or {}
    idea_id = data.get('idea_id')
    if not idea_id:
        return jsonify({'error': 'idea_id is required.'}), 400

    user_id = get_user_id()

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute('SELECT user_id, content FROM ideas WHERE id = ?', (idea_id,))
    row = cursor.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        return jsonify({'error': 'Idea not found.'}), 404
    current_content = row[1] or ''

    cursor.execute(
        "SELECT filename FROM idea_media WHERE idea_id = ? AND media_type = 'audio' ORDER BY id DESC LIMIT 1",
        (idea_id,),
    )
    mrow = cursor.fetchone()
    if not mrow:
        conn.close()
        return jsonify({'error': 'No audio attached to this idea.'}), 404

    filepath = os.path.join('uploads', mrow[0])
    if not os.path.exists(filepath):
        conn.close()
        return jsonify({'error': 'Audio file missing on disk.'}), 404

    try:
        with open(filepath, 'rb') as f:
            result = _openai_client.audio.transcriptions.create(
                model='whisper-1',
                file=f,
            )
        text = (getattr(result, 'text', '') or '').strip()
    except Exception as e:
        conn.close()
        return jsonify({'error': f'Transcription failed: {e}'}), 500

    if not text:
        conn.close()
        return jsonify({'error': 'Empty transcription.'}), 500

    if current_content.strip():
        new_content = f"{current_content}\n\n{text}"
    else:
        new_content = text

    cursor.execute('UPDATE ideas SET content = ? WHERE id = ?', (new_content, idea_id))
    conn.commit()
    conn.close()

    return jsonify({'id': idea_id, 'content': new_content, 'transcription': text}), 200


# In-memory job tracker for async daily-summary generation.
# Key: (user_id, date_str). Value: 'pending' or 'error:<msg>'.
# Cleared once the row lands in daily_summaries (or on error read).
_summary_jobs_lock = threading.Lock()
_summary_jobs: dict = {}


def _build_summary_prompt(ideas_blob: str) -> str:
    """Build the Ollama prompt for daily summaries. Optimised for small models
    (llama3.2:3b) — one-shot example, explicit structure, low instruction density."""
    return (
        "You are summarizing someone's personal journal entries from one day.\n\n"
        "Rules:\n"
        "1. Write exactly 3-5 sentences in second person ('you').\n"
        "2. First sentence: the overall vibe/emotional tone of the day in one line.\n"
        "3. Middle sentences: main themes, recurring threads, and anything notable.\n"
        "4. Last sentence: any decisions made or action items, starting with '→'. "
        "If there are none, skip this.\n"
        "5. Only describe what is written. Do not invent or assume anything.\n"
        "6. No headings, no bullet points, no preamble. Just the paragraph.\n\n"
        "Example input:\n"
        "- [09:15] woke up feeling decent, had coffee\n"
        "- [11:30] meeting with tom about the project timeline, we agreed to push it back a week\n"
        "- [14:00] feeling anxious about the deadline still\n"
        "- [20:00] went for a run, cleared my head\n\n"
        "Example output:\n"
        "You had a mixed day — decent energy in the morning but anxiety crept in by afternoon. "
        "Work dominated your headspace, especially the project timeline discussion with Tom. "
        "You closed the day with a run that helped reset. "
        "→ You and Tom agreed to push the project deadline back one week.\n\n"
        f"Now summarize this day:\n{ideas_blob}"
    )


def _run_summary_job(user_id, date_str, prompt, model, idea_count):
    try:
        summary = _ollama_chat(prompt, model)
        if not summary:
            with _summary_jobs_lock:
                _summary_jobs[(user_id, date_str)] = 'error:Empty summary.'
            return
        conn = get_conn()
        try:
            cursor = conn.cursor()
            created_at = datetime.now(VANCOUVER_TZ).strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute(
                'INSERT OR REPLACE INTO daily_summaries (user_id, date, content, idea_count, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                (user_id, date_str, summary, idea_count, model, created_at),
            )
            conn.commit()
        finally:
            conn.close()
        with _summary_jobs_lock:
            _summary_jobs.pop((user_id, date_str), None)
    except Exception as e:
        with _summary_jobs_lock:
            _summary_jobs[(user_id, date_str)] = f'error:{e}'


def _ollama_chat(prompt: str, model: str) -> str:
    """Call local Ollama /api/chat and return the assistant's text.
    Raises RuntimeError on any transport/parse failure."""
    import urllib.request
    import urllib.error
    url = os.environ.get('OLLAMA_URL', 'http://ollama:11434').rstrip('/') + '/api/chat'
    payload = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        # Keep model resident for 30 min after each call — avoids the cold-start
        # penalty (model weights take ~15-30s to load into RAM on CPU) when the
        # user hits the summary button twice in one session.
        'keep_alive': '30m',
        'options': {'temperature': 0.5, 'num_ctx': 4096},
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=580) as resp:
            body = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Ollama HTTP {e.code}: {e.read().decode("utf-8", "ignore")[:200]}')
    except Exception as e:
        raise RuntimeError(f'Ollama request failed: {e}')
    msg = (body.get('message') or {}).get('content') or ''
    return msg.strip()


def _auto_generate_summaries():
    """End-of-day auto-summary: at 11:59 PM Vancouver time, generate a summary
    for every user who captured ideas today but hasn't generated one yet."""
    import time
    while True:
        now = datetime.now(VANCOUVER_TZ)
        target = now.replace(hour=23, minute=59, second=0, microsecond=0)
        if now >= target:
            from datetime import timedelta
            target += timedelta(days=1)
        sleep_secs = (target - now).total_seconds()
        time.sleep(sleep_secs)

        date_str = datetime.now(VANCOUVER_TZ).strftime('%Y-%m-%d')
        model = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')
        try:
            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT DISTINCT user_id FROM ideas WHERE timestamp LIKE ?",
                (f'{date_str}%',),
            )
            user_ids = [r['user_id'] for r in cursor.fetchall()]
            for uid in user_ids:
                cursor.execute(
                    'SELECT 1 FROM daily_summaries WHERE user_id = ? AND date = ?',
                    (uid, date_str),
                )
                if cursor.fetchone():
                    continue
                cursor.execute(
                    "SELECT content, timestamp FROM ideas WHERE user_id = ? AND timestamp LIKE ? ORDER BY timestamp ASC",
                    (uid, f'{date_str}%'),
                )
                rows = cursor.fetchall()
                if not rows:
                    continue
                lines = []
                for r in rows:
                    text = (r['content'] or '').strip()
                    if not text:
                        continue
                    time_part = (r['timestamp'] or '').split(' ')[1][:5] if ' ' in (r['timestamp'] or '') else ''
                    lines.append(f"- [{time_part}] {text}")
                if not lines:
                    continue
                ideas_blob = '\n'.join(lines)
                prompt = _build_summary_prompt(ideas_blob)
                t = threading.Thread(
                    target=_run_summary_job,
                    args=(uid, date_str, prompt, model, len(rows)),
                    daemon=True,
                )
                t.start()
            conn.close()
        except Exception as e:
            print(f"[auto-summary] Error: {e}")


_auto_summary_thread = threading.Thread(target=_auto_generate_summaries, daemon=True)
_auto_summary_thread.start()


@app.route('/summary/daily', methods=['POST'])
def daily_summary():
    user_id = get_user_id()
    if not user_id:
        return jsonify({'error': 'Unauthorized.'}), 401

    data = request.get_json(silent=True) or {}
    force = bool(data.get('force'))
    date_str = data.get('date') or datetime.now(VANCOUVER_TZ).strftime('%Y-%m-%d')

    conn = get_conn()
    cursor = conn.cursor()

    if not force:
        cursor.execute(
            'SELECT content, idea_count, created_at FROM daily_summaries WHERE user_id = ? AND date = ?',
            (user_id, date_str),
        )
        cached = cursor.fetchone()
        if cached:
            conn.close()
            return jsonify({
                'date': date_str,
                'summary': cached['content'],
                'idea_count': cached['idea_count'],
                'created_at': cached['created_at'],
                'cached': True,
            }), 200

    cursor.execute(
        "SELECT content, timestamp FROM ideas WHERE user_id = ? AND timestamp LIKE ? ORDER BY timestamp ASC",
        (user_id, f'{date_str}%'),
    )
    rows = cursor.fetchall()
    if not rows:
        conn.close()
        return jsonify({'error': 'No ideas for this date.'}), 404

    lines = []
    for r in rows:
        text = (r['content'] or '').strip()
        if not text:
            continue
        time_part = (r['timestamp'] or '').split(' ')[1][:5] if ' ' in (r['timestamp'] or '') else ''
        lines.append(f"- [{time_part}] {text}")
    ideas_blob = '\n'.join(lines)

    prompt = _build_summary_prompt(ideas_blob)

    model = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')
    conn.close()

    # Fire-and-forget: Ollama on CPU can take 30-120s, which exceeds the
    # gunicorn worker timeout. Run in a daemon thread and let the client poll
    # GET /summary/daily until the row appears.
    key = (user_id, date_str)
    with _summary_jobs_lock:
        already_pending = _summary_jobs.get(key) == 'pending'
        if not already_pending:
            _summary_jobs[key] = 'pending'

    if not already_pending:
        t = threading.Thread(
            target=_run_summary_job,
            args=(user_id, date_str, prompt, model, len(rows)),
            daemon=True,
        )
        t.start()

    return jsonify({
        'date': date_str,
        'status': 'pending',
        'idea_count': len(rows),
    }), 202


@app.route('/summary/daily/all', methods=['GET'])
def daily_summary_all():
    user_id = get_user_id()
    if not user_id:
        return jsonify({'error': 'Unauthorized.'}), 401
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT date, content, idea_count, created_at FROM daily_summaries WHERE user_id = ? ORDER BY date DESC',
        (user_id,),
    )
    rows = [
        {
            'date': r['date'],
            'summary': r['content'],
            'idea_count': r['idea_count'],
            'created_at': r['created_at'],
        }
        for r in cursor.fetchall()
    ]
    conn.close()
    return jsonify({'summaries': rows}), 200


@app.route('/summary/daily', methods=['GET'])
def daily_summary_get():
    user_id = get_user_id()
    if not user_id:
        return jsonify({'error': 'Unauthorized.'}), 401
    date_str = request.args.get('date') or datetime.now(VANCOUVER_TZ).strftime('%Y-%m-%d')
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT content, idea_count, created_at FROM daily_summaries WHERE user_id = ? AND date = ?',
        (user_id, date_str),
    )
    row = cursor.fetchone()
    conn.close()
    if row:
        return jsonify({
            'date': date_str,
            'summary': row['content'],
            'idea_count': row['idea_count'],
            'created_at': row['created_at'],
            'cached': True,
        }), 200

    key = (user_id, date_str)
    with _summary_jobs_lock:
        job = _summary_jobs.get(key)
        if job and job.startswith('error:'):
            _summary_jobs.pop(key, None)
            return jsonify({'date': date_str, 'summary': None, 'error': job[6:]}), 200
    if job == 'pending':
        return jsonify({'date': date_str, 'summary': None, 'pending': True}), 200
    return jsonify({'date': date_str, 'summary': None}), 200


@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory('uploads', filename)


# --- Feed API ---

@app.route('/feed', methods=['GET'])
def get_feed():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT sf.id, sf.idea_id, sf.user_id, sf.shared_at,
                   i.content,
                   u.username as author_username,
                   u.avatar_filename,
                   CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END as viewer_starred
            FROM shared_feed sf
            JOIN ideas i ON i.id = sf.idea_id
            JOIN users u ON u.id = sf.user_id
            LEFT JOIN feed_stars fs ON fs.idea_id = sf.idea_id AND fs.user_id = ?
            ORDER BY sf.shared_at DESC
        ''', (user_id,))
        rows = cursor.fetchall()

        idea_ids = [r['idea_id'] for r in rows]
        media_by_idea = {}
        if idea_ids:
            placeholders = ','.join('?' * len(idea_ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                idea_ids
            )
            for m in cursor.fetchall():
                media_by_idea.setdefault(m['idea_id'], []).append({
                    'id': m['id'],
                    'media_type': m['media_type'],
                    'file_size': m['file_size'],
                    'url': f"/api/flask/uploads/{m['filename']}"
                })

        posts = []
        for row in rows:
            avatar_url = None
            if row['avatar_filename']:
                avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"
            posts.append({
                'id': row['id'],
                'idea_id': row['idea_id'],
                'shared_at': row['shared_at'],
                'author': {
                    'username': row['author_username'],
                    'avatar_url': avatar_url,
                },
                'content': row['content'],
                'media': media_by_idea.get(row['idea_id'], []),
                'is_mine': row['user_id'] == user_id,
                'viewer_starred': bool(row['viewer_starred']),
            })

        conn.close()
        return jsonify({'posts': posts}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/share/<int:idea_id>', methods=['POST'])
def share_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM ideas WHERE id = ? AND user_id = ?', (idea_id, user_id))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Idea not found or not yours'}), 403

        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        try:
            cursor.execute(
                'INSERT INTO shared_feed (idea_id, user_id, shared_at) VALUES (?, ?, ?)',
                (idea_id, user_id, vancouver_time)
            )
            shared_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Already shared'}), 409

        conn.commit()
        conn.close()
        return jsonify({'id': shared_id}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/share/<int:idea_id>', methods=['DELETE'])
def unshare_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        cursor = conn.cursor()

        cursor.execute(
            'DELETE FROM shared_feed WHERE idea_id = ? AND user_id = ?',
            (idea_id, user_id)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Unshared'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/ideas/<int:idea_id>', methods=['GET'])
def get_feed_idea(idea_id):
    """Return any shared idea — accessible to all logged-in users, not just the owner."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT sf.shared_at, sf.user_id as author_id,
                   i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color,
                   u.username as author_username,
                   u.avatar_filename,
                   CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END as viewer_starred
            FROM shared_feed sf
            JOIN ideas i ON i.id = sf.idea_id
            JOIN users u ON u.id = sf.user_id
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN feed_stars fs ON fs.idea_id = sf.idea_id AND fs.user_id = ?
            WHERE sf.idea_id = ?
        ''', (user_id, idea_id))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return jsonify({'error': 'Not found or not shared'}), 404

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

        avatar_url = None
        if row['avatar_filename']:
            avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"

        conn.close()
        return jsonify({
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'shared_at': row['shared_at'],
            'author': {'username': row['author_username'], 'avatar_url': avatar_url},
            'is_mine': row['author_id'] == user_id,
            'viewer_starred': bool(row['viewer_starred']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/star/<int:idea_id>', methods=['POST'])
def star_feed_post(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        cursor = conn.cursor()
        # Must be a shared idea
        cursor.execute('SELECT id FROM shared_feed WHERE idea_id = ?', (idea_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Post not found in feed'}), 404
        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        try:
            cursor.execute(
                'INSERT INTO feed_stars (user_id, idea_id, starred_at) VALUES (?, ?, ?)',
                (user_id, idea_id, vancouver_time)
            )
        except sqlite3.IntegrityError:
            pass  # Already starred — idempotent
        conn.commit()
        conn.close()
        return jsonify({'message': 'Starred'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/star/<int:idea_id>', methods=['DELETE'])
def unstar_feed_post(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            'DELETE FROM feed_stars WHERE user_id = ? AND idea_id = ?',
            (user_id, idea_id)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Unstarred'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/starred', methods=['GET'])
def get_starred_feed_posts():
    """Returns feed posts starred by the current viewer."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT sf.id, sf.idea_id, sf.user_id, sf.shared_at,
                   i.content,
                   u.username as author_username,
                   u.avatar_filename
            FROM feed_stars fs
            JOIN shared_feed sf ON sf.idea_id = fs.idea_id
            JOIN ideas i ON i.id = sf.idea_id
            JOIN users u ON u.id = sf.user_id
            WHERE fs.user_id = ?
            ORDER BY fs.starred_at DESC
        ''', (user_id,))
        rows = cursor.fetchall()

        idea_ids = [r['idea_id'] for r in rows]
        media_by_idea = {}
        if idea_ids:
            placeholders = ','.join('?' * len(idea_ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                idea_ids
            )
            for m in cursor.fetchall():
                media_by_idea.setdefault(m['idea_id'], []).append({
                    'id': m['id'],
                    'media_type': m['media_type'],
                    'file_size': m['file_size'],
                    'url': f"/api/flask/uploads/{m['filename']}"
                })

        posts = []
        for row in rows:
            avatar_url = None
            if row['avatar_filename']:
                avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"
            posts.append({
                'id': row['id'],
                'idea_id': row['idea_id'],
                'shared_at': row['shared_at'],
                'author': {'username': row['author_username'], 'avatar_url': avatar_url},
                'content': row['content'],
                'media': media_by_idea.get(row['idea_id'], []),
                'is_mine': row['user_id'] == user_id,
                'viewer_starred': True,
            })

        conn.close()
        return jsonify({'posts': posts}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- Profile API ---

@app.route('/profile', methods=['GET'])
def get_profile():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT username, avatar_filename FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({'error': 'User not found'}), 404
        avatar_url = None
        if row['avatar_filename']:
            avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"
        return jsonify({'username': row['username'], 'avatar_url': avatar_url}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/profile/avatar', methods=['POST'])
def upload_avatar():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401

    username = request.headers.get('X-Think-Tank-User', 'unknown').strip().lower()

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    content_type = file.content_type or ''
    if not content_type.startswith('image/'):
        return jsonify({'error': 'Only images allowed'}), 400

    ext_map = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic'}
    ext = ext_map.get(content_type, 'jpg')
    filename = f"{username}.{ext}"
    filepath = os.path.join('uploads', 'avatars', filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    try:
        file.save(filepath)
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET avatar_filename = ? WHERE id = ?', (filename, user_id))
        conn.commit()
        conn.close()
        import time
        avatar_url = f"/api/flask/uploads/avatars/{filename}?v={int(time.time())}"
        return jsonify({'avatar_url': avatar_url}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- Categories API ---

@app.route('/categories', methods=['GET'])
def list_categories():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
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
        conn = get_conn()
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


@app.route('/categories/<int:cat_id>', methods=['PATCH'])
def update_category(cat_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    try:
        conn = get_conn()
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


@app.route('/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = get_conn()
        cursor = conn.cursor()

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=6000)
