import sqlite3
import json
import threading
import os
import re
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

# --- Timezone Setup ---
VANCOUVER_TZ = ZoneInfo("America/Vancouver")

# --- Embedding Model ---
print("Loading nomic-embed-text-v1.5 model...")
embed_model = SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)
print("Model loaded.")

CATEGORY_DESCRIPTIONS = {
    "Tech / Experiments": "technology, programming, software, hardware, coding, experiments, tools, APIs, apps",
    "Music": "music, instruments, synths, plugins, production, songs, albums, concerts, audio",
    "Books": "books, reading, literature, authors, novels, articles, writing",
    "Personal / Philosophical": "personal life, philosophy, thoughts, reflections, relationships, meaning",
    "Productivity": "productivity, workflow, habits, systems, efficiency, organization, planning",
    "Gym / Health": "gym, exercise, fitness, health, nutrition, diet, workout, running",
    "Misc": "miscellaneous, random, other, general",
}


def generate_embedding(text):
    """Generate embedding for a text string using nomic model."""
    embedding = embed_model.encode([f"search_document: {text}"])[0]
    return embedding.tolist()


def auto_categorize(idea_id, content):
    """Auto-categorize an idea in a background thread."""
    try:
        embedding = generate_embedding(content)
        embedding_json = json.dumps(embedding)

        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        cursor.execute("SELECT id, name, embedding FROM categories WHERE embedding IS NOT NULL")
        categories = cursor.fetchall()

        if not categories:
            # Still save the embedding even without categories
            cursor.execute("UPDATE ideas SET embedding = ? WHERE id = ?", (embedding_json, idea_id))
            conn.commit()
            conn.close()
            return

        idea_vec = np.array(embedding).reshape(1, -1)
        best_cat_id = None
        best_score = -1

        for cat_id, cat_name, cat_embedding_json in categories:
            cat_vec = np.array(json.loads(cat_embedding_json)).reshape(1, -1)
            score = cosine_similarity(idea_vec, cat_vec)[0][0]
            if score > best_score:
                best_score = score
                best_cat_id = cat_id

        cursor.execute(
            "UPDATE ideas SET embedding = ?, category_id = ? WHERE id = ?",
            (embedding_json, best_cat_id, idea_id)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Auto-categorize error for idea {idea_id}: {e}")


def seed_category_embeddings():
    """Generate embeddings for categories that don't have them yet."""
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM categories WHERE embedding IS NULL")
    rows = cursor.fetchall()

    for cat_id, cat_name in rows:
        desc = CATEGORY_DESCRIPTIONS.get(cat_name, cat_name)
        embedding = generate_embedding(desc)
        cursor.execute(
            "UPDATE categories SET embedding = ? WHERE id = ?",
            (json.dumps(embedding), cat_id)
        )

    conn.commit()
    conn.close()

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
seed_category_embeddings()

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=6000)
