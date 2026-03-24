import sqlite3
import json
import os
import re
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

    # New tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
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

    # Migrate ideas table: add new columns if missing
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

    # Seed default categories if empty
    cursor.execute("SELECT COUNT(*) FROM categories")
    if cursor.fetchone()[0] == 0:
        default_categories = [
            ("Tech / Experiments", "#60a5fa", 0),
            ("Music", "#a78bfa", 1),
            ("Books", "#34d399", 2),
            ("Personal / Philosophical", "#f472b6", 3),
            ("Productivity", "#facc15", 4),
            ("Gym / Health", "#fb923c", 5),
            ("Misc", "#71717a", 6),
        ]
        cursor.executemany(
            "INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
            default_categories
        )

    conn.commit()
    conn.close()

# --- Flask App ---
init_db()
app = Flask(__name__)

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

    # Background: generate embedding + auto-categorize
    threading.Thread(target=auto_categorize, args=(idea_id, content)).start()

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

    # Sort: stalest first, then by size weight
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


# --- New API Endpoints ---

ALLOWED_MIME_PREFIXES = ('image/', 'video/')
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE


def sanitize_filename(name):
    """Strip path separators and special chars, keep alphanumeric, hyphens, underscores, dots."""
    name = os.path.basename(name)
    name = re.sub(r'[^\w\-.]', '_', name)
    return name


@app.route('/ideas', methods=['GET'])
def list_ideas():
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            ORDER BY i.timestamp DESC
        ''')
        ideas_rows = cursor.fetchall()

        # Fetch all media in one query, group by idea_id
        cursor.execute('SELECT id, idea_id, filename, original_name, media_type, file_size, created_at FROM idea_media')
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
    data = request.get_json()
    content = data.get('content', '')
    category_id = data.get('category_id')

    # Allow media-only ideas (content can be empty if media will be attached)

    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            'INSERT INTO ideas (content, timestamp, category_id) VALUES (?, ?, ?)',
            (content, vancouver_time, category_id)
        )
        idea_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return jsonify({'id': idea_id, 'message': 'Idea saved.'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/<int:idea_id>', methods=['GET'])
def get_idea(idea_id):
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.id = ?
        ''', (idea_id,))
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

        idea = {
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }
        return jsonify(idea), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ideas/<int:idea_id>', methods=['PATCH'])
def update_idea(idea_id):
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

        values.append(idea_id)
        cursor.execute(f"UPDATE ideas SET {', '.join(updates)} WHERE id = ?", values)

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
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        # Check idea exists first
        cursor.execute('SELECT id FROM ideas WHERE id = ?', (idea_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404

        # Get media files to delete from disk
        cursor.execute('SELECT filename FROM idea_media WHERE idea_id = ?', (idea_id,))
        media_files = [row[0] for row in cursor.fetchall()]

        cursor.execute('DELETE FROM idea_media WHERE idea_id = ?', (idea_id,))
        cursor.execute('DELETE FROM ideas WHERE id = ?', (idea_id,))
        conn.commit()
        conn.close()

        # Delete files from disk
        for filename in media_files:
            filepath = os.path.join('uploads', filename)
            if os.path.exists(filepath):
                os.remove(filepath)

        return jsonify({'message': 'Idea deleted.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/search', methods=['POST'])
def semantic_search():
    # Semantic search disabled (ML model removed)
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

    # Determine content type — fall back to guessing from filename
    import mimetypes
    content_type = file.content_type or ''
    if not content_type or content_type == 'application/octet-stream':
        guessed, _ = mimetypes.guess_type(file.filename)
        content_type = guessed or ''

    if not any(content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        return jsonify({'error': f'File type not allowed: {content_type or "unknown"}'}), 400

    try:
        sanitized = sanitize_filename(file.filename)
        stored_filename = f"{idea_id}_{sanitized}"
        filepath = os.path.join('uploads', stored_filename)

        os.makedirs('uploads', exist_ok=True)
        file.save(filepath)
        file_size = os.path.getsize(filepath)

        # Determine media type — sketches are uploaded as sketch.png
        if file.filename == 'sketch.png':
            media_type = 'sketch'
        elif content_type.startswith('image/'):
            media_type = 'image'
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

        # Update idea's media_type and has_media
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


@app.route('/categories', methods=['GET'])
def list_categories():
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, color, sort_order FROM categories ORDER BY sort_order')
        categories = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'categories': categories}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/categories', methods=['POST'])
def create_category():
    data = request.get_json()
    name = data.get('name', '').strip()
    color = data.get('color', '#71717a')

    if not name:
        return jsonify({'error': 'Name is required.'}), 400

    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        cursor.execute('SELECT MAX(sort_order) FROM categories')
        max_order = cursor.fetchone()[0] or 0

        cursor.execute(
            'INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)',
            (name, color, max_order + 1)
        )
        cat_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return jsonify({'id': cat_id, 'message': 'Category created.'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Category name already exists.'}), 409
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/categories/<int:cat_id>', methods=['PATCH'])
def update_category(cat_id):
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

        values.append(cat_id)
        cursor.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = ?", values)

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
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        # Reassign ideas to "Misc" category
        cursor.execute("SELECT id FROM categories WHERE name = 'Misc'")
        misc_row = cursor.fetchone()
        misc_id = misc_row[0] if misc_row else None

        if misc_id:
            cursor.execute(
                'UPDATE ideas SET category_id = ? WHERE category_id = ?',
                (misc_id, cat_id)
            )

        cursor.execute('DELETE FROM categories WHERE id = ?', (cat_id,))

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
