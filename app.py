import sqlite3
from flask import Flask, request, jsonify
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# --- Timezone Setup ---
VANCOUVER_TZ = ZoneInfo("America/Vancouver")

# --- Database Setup ---
def init_db():
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()

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

    # Migrate existing todo table: add size if missing
    cursor.execute("PRAGMA table_info(todo)")
    todo_cols = [col[1] for col in cursor.fetchall()]
    if "size" not in todo_cols:
        cursor.execute("ALTER TABLE todo ADD COLUMN size TEXT DEFAULT 'small'")

    # Migrate existing completed_todo table: add size if missing
    cursor.execute("PRAGMA table_info(completed_todo)")
    completed_cols = [col[1] for col in cursor.fetchall()]
    if "size" not in completed_cols:
        cursor.execute("ALTER TABLE completed_todo ADD COLUMN size TEXT DEFAULT 'small'")
    if "completed_timestamp" not in completed_cols:
        cursor.execute("ALTER TABLE completed_todo ADD COLUMN completed_timestamp DATETIME")

    conn.commit()
    conn.close()

# --- Flask App ---
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
    conn.commit()
    conn.close()

    return jsonify({'message': 'Note added successfully.'}), 201


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


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=6000)
