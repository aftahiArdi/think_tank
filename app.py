import sqlite3
import json
import os
import re
import threading
import bcrypt as _bcrypt
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

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

    # NOTE: Default category seeding removed — handled per-user by create_users.py

    conn.commit()
    conn.close()


# --- Flask App ---
init_db()
app = Flask(__name__)

# In-memory cache: username → user_id (populated on first request per username)
_user_id_cache: dict = {}


def get_user_id():
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


# --- Auth ---

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


# --- Legacy endpoints (iOS Shortcut / todo) ---

@app.route('/add_note', methods=['POST'])
def add_note():
    data = request.get_json()
    content = data.get('content')

    if not content:
        return jsonify({'error': 'Content is required.'}), 400

    conn = sqlite3.connect('notes.db')
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

    conn = sqlite3.connect('notes.db')
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
    conn = sqlite3.connect('notes.db')
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

    conn = sqlite3.connect('notes.db')
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

    conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
            WHERE i.user_id = ?
            ORDER BY i.timestamp DESC
        ''', (user_id,))
        ideas_rows = cursor.fetchall()

        cursor.execute(
            'SELECT id, idea_id, filename, original_name, media_type, file_size FROM idea_media WHERE idea_id IN (SELECT id FROM ideas WHERE user_id = ?)',
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

        conn.close()
        return jsonify({'ideas': ideas, 'total': len(ideas)}), 200
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

        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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


@app.route('/feed/star/<int:idea_id>', methods=['POST'])
def star_feed_post(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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
        conn = sqlite3.connect('notes.db')
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


@app.route('/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
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
