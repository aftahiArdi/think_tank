import sqlite3
from flask import Flask, request, jsonify
from datetime import datetime
from zoneinfo import ZoneInfo

# --- Timezone Setup ---
VANCOUVER_TZ = ZoneInfo("America/Vancouver")

# --- Database Setup ---
def init_db():
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()
    # Create tables if they don't exist
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
            priority TEXT DEFAULT 'Medium',
            timestamp DATETIME
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS completed_todo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            priority TEXT DEFAULT 'Medium',
            timestamp DATETIME
        )
    ''')
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

    # Get Vancouver time
    vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute('''
        INSERT INTO ideas (content, timestamp)
        VALUES (?, ?)
    ''', (content, vancouver_time))

    conn.commit()
    conn.close()

    return jsonify({'message': 'Note added successfully.'}), 201


@app.route('/add_todo', methods=['POST'])
def add_todo():
    data = request.get_json()
    content = data.get('content')
    priority = data.get('priority', 'Medium')

    if not content:
        return jsonify({'error': 'Content is required.'}), 400

    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()

    # Get Vancouver time
    vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute('''
        INSERT INTO todo (content, priority, timestamp)
        VALUES (?, ?, ?)
    ''', (content, priority, vancouver_time))
    
    conn.commit()
    conn.close()

    return jsonify({'message': 'To-Do item added successfully.'}), 201



if __name__ == '__main__':
    init_db()  # Ensure database and tables exist when app starts
    app.run(host='0.0.0.0', port=6000)
