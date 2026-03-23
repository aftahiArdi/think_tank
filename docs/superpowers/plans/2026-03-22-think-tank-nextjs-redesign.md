# Think Tank Next.js Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit frontend with a Next.js app (shadcn/ui + React Bits), extend Flask with new endpoints (media upload, semantic search, categories, auto-categorization), and add a password gate.

**Architecture:** Next.js (port 3000) proxies all requests to Flask (port 6000) over Docker internal network. SQLite + local filesystem for storage. `nomic-embed-text-v1.5` for embeddings and auto-categorization, loaded once on startup. Browser never talks to Flask directly.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, shadcn/ui, React Bits, Framer Motion, Fuse.js, react-sketch-canvas, SWR, react-window | Flask, Gunicorn, SQLite, sentence-transformers (nomic), scikit-learn

**Spec:** `docs/superpowers/specs/2026-03-22-think-tank-nextjs-redesign.md`

---

## File Map

### Backend (Modified/New)

| File | Action | Responsibility |
|------|--------|---------------|
| `app.py` | Modify | Add new endpoints, schema migrations, embedding model loading, auto-categorization, upload handling |
| `requirements.txt` | Modify | Add `sentence-transformers`, `pillow`, `torch`; remove `streamlit`, `pandas`, `openai` |
| `Dockerfile.api` | Create | Flask container with nomic model pre-downloaded |
| `migrate_embeddings.py` | Create | One-time script to regenerate all embeddings and auto-categorize |
| `docker-compose.yml` | Modify | Replace streamlit service with nextjs, add volumes for uploads |
| `deploy.sh` | Modify | Build two images instead of one |
| `.env` | Modify | Add `THINK_TANK_PASSWORD`, `COOKIE_SECRET` |

### Frontend (All New — `frontend/` directory)

| File | Responsibility |
|------|---------------|
| `frontend/package.json` | Dependencies |
| `frontend/next.config.ts` | API proxy rewrites to Flask |
| `frontend/tailwind.config.ts` | Tailwind config with theme CSS vars |
| `frontend/tsconfig.json` | TypeScript config |
| `frontend/middleware.ts` | Auth cookie check, redirect to `/login` |
| `frontend/app/globals.css` | Theme CSS variables (3 themes), Tailwind base |
| `frontend/app/layout.tsx` | Root layout, theme provider, fonts |
| `frontend/app/page.tsx` | Main app — tab container (Ideas, Search, Categories) |
| `frontend/app/login/page.tsx` | Password gate with aurora background |
| `frontend/app/api/auth/route.ts` | Auth API route (password check, cookie set/clear) |
| `frontend/lib/types.ts` | TypeScript types: Idea, Category, IdeaMedia |
| `frontend/lib/api.ts` | Flask API client (fetch wrappers via `/api/flask/`) |
| `frontend/lib/hooks/use-ideas.ts` | SWR hook for ideas data + mutations |
| `frontend/lib/hooks/use-search.ts` | Combined fuzzy (Fuse.js) + semantic search hook |
| `frontend/lib/hooks/use-categories.ts` | SWR hook for categories |
| `frontend/lib/hooks/use-upload.ts` | File upload with compression |
| `frontend/lib/utils/dates.ts` | Date formatting, grouping by day |
| `frontend/lib/utils/compress.ts` | Client-side image compression wrapper |
| `frontend/lib/utils/theme.ts` | Theme CSS variable maps |
| `frontend/components/layout/header.tsx` | App header with gradient text |
| `frontend/components/layout/bottom-nav.tsx` | iOS-style bottom tab bar |
| `frontend/components/layout/fab.tsx` | Floating action button with magnet effect |
| `frontend/components/auth/password-gate.tsx` | Login form component |
| `frontend/components/theme/theme-provider.tsx` | Theme context provider |
| `frontend/components/theme/theme-selector.tsx` | Theme picker UI |
| `frontend/components/ideas/idea-feed.tsx` | Virtualized idea list grouped by date |
| `frontend/components/ideas/idea-card.tsx` | Single idea card with spotlight effect |
| `frontend/components/ideas/idea-detail.tsx` | Expanded idea view |
| `frontend/components/ideas/capture-sheet.tsx` | Bottom sheet for creating ideas |
| `frontend/components/search/search-bar.tsx` | Search input with deep search toggle |
| `frontend/components/search/search-results.tsx` | Search results with relevance scores |
| `frontend/components/categories/category-filter.tsx` | Horizontal scrollable category pills |
| `frontend/components/categories/category-badge.tsx` | Colored badge component |
| `frontend/components/categories/category-manager.tsx` | Category settings CRUD |
| `frontend/components/sketch/sketch-pad.tsx` | react-sketch-canvas wrapper |
| `frontend/Dockerfile` | Multi-stage Next.js build |

---

## Task 1: Backend — Schema Migrations & Database Setup

**Files:**
- Modify: `app.py:10-56` (init_db function)
- Modify: `requirements.txt`

- [ ] **Step 1: Update requirements.txt**

Remove packages no longer needed by the API container, add new ones:

```
flask==3.1.2
gunicorn==23.0.0
sentence-transformers>=3.0.0
scikit-learn==1.7.2
scipy==1.16.2
pillow>=10.0.0
python-dotenv==1.1.1
pytz==2025.2
numpy==2.3.3
tzdata==2025.2
torch
```

Removed: `streamlit`, `pandas`, `openai`
Added: `sentence-transformers`, `pillow`, `torch`

- [ ] **Step 2: Update init_db() to add new tables and columns**

In `app.py`, update `init_db()` to:
1. Create `categories` table
2. Create `idea_media` table
3. Add `media_type`, `has_media`, `category_id`, `embedding` columns to `ideas` if missing
4. Seed default categories if empty

```python
def init_db():
    conn = sqlite3.connect('notes.db')
    cursor = conn.cursor()

    # Existing tables (keep as-is)
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
```

- [ ] **Step 3: Test migration locally**

Run: `python -c "import app; app.init_db()"`

Verify with: `sqlite3 notes.db ".tables"` — should show `categories`, `idea_media` alongside existing tables.
Verify with: `sqlite3 notes.db "PRAGMA table_info(ideas)"` — should show new columns.
Verify with: `sqlite3 notes.db "SELECT * FROM categories"` — should show 7 default categories.

- [ ] **Step 4: Commit**

```bash
git add app.py requirements.txt
git commit -m "feat: add schema migrations for categories, idea_media, and new ideas columns"
```

---

## Task 2: Backend — Embedding Model & Auto-Categorization Engine

**Files:**
- Modify: `app.py` (add model loading + categorization functions)

- [ ] **Step 1: Add model loading at app startup**

At the top of `app.py`, after imports, add the embedding model setup:

```python
import json
import threading
import os
import re
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

# Load embedding model once at startup
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
```

- [ ] **Step 2: Add helper functions for embeddings and categorization**

```python
def generate_embedding(text):
    """Generate embedding for a text string using nomic model."""
    embedding = embed_model.encode([f"search_document: {text}"])[0]
    return embedding.tolist()

def auto_categorize(idea_id, content):
    """Auto-categorize an idea by comparing its embedding to category embeddings.
    Runs in a background thread. Opens its own DB connection."""
    try:
        embedding = generate_embedding(content)
        embedding_json = json.dumps(embedding)

        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        # Get all categories with embeddings
        cursor.execute("SELECT id, name, embedding FROM categories WHERE embedding IS NOT NULL")
        categories = cursor.fetchall()

        if not categories:
            conn.close()
            return

        # Find best matching category
        idea_vec = np.array(embedding).reshape(1, -1)
        best_cat_id = None
        best_score = -1

        for cat_id, cat_name, cat_embedding_json in categories:
            cat_vec = np.array(json.loads(cat_embedding_json)).reshape(1, -1)
            score = cosine_similarity(idea_vec, cat_vec)[0][0]
            if score > best_score:
                best_score = score
                best_cat_id = cat_id

        # Update the idea with embedding and category
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
```

- [ ] **Step 3: Call seed_category_embeddings() after init_db()**

Update the bottom of `app.py`:

```python
if __name__ == '__main__':
    init_db()
    seed_category_embeddings()
    app.run(host='0.0.0.0', port=6000)
```

Also add a gunicorn-compatible startup hook. Before the `app = Flask(__name__)` line, move the init calls into the module level so they run when gunicorn imports the app:

```python
init_db()
app = Flask(__name__)

# Seed category embeddings after model loads
# (done after app creation so gunicorn workers have it ready)
seed_category_embeddings()
```

- [ ] **Step 4: Update /add_note to trigger auto-categorization in background**

Modify the existing `add_note()` to queue background embedding + categorization:

```python
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
```

- [ ] **Step 5: Commit**

```bash
git add app.py
git commit -m "feat: add nomic embedding model, auto-categorization engine, background processing"
```

---

## Task 3: Backend — New API Endpoints (Ideas, Search, Upload, Categories)

**Files:**
- Modify: `app.py` (add new route handlers)

- [ ] **Step 1: Add GET /ideas endpoint**

```python
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
```

- [ ] **Step 2: Add POST /ideas endpoint**

```python
@app.route('/ideas', methods=['POST'])
def create_idea():
    data = request.get_json()
    content = data.get('content', '')
    category_id = data.get('category_id')

    if not content and not category_id:
        return jsonify({'error': 'Content is required.'}), 400

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

        # Auto-categorize in background if no category was provided
        if not category_id and content:
            threading.Thread(target=auto_categorize, args=(idea_id, content)).start()

        return jsonify({'id': idea_id, 'message': 'Idea saved.'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 3: Add PATCH /ideas/<id> and DELETE /ideas/<id>**

```python
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
```

- [ ] **Step 4: Add POST /search endpoint**

```python
@app.route('/search', methods=['POST'])
def semantic_search():
    data = request.get_json()
    query = data.get('query', '').strip()

    if not query:
        return jsonify({'error': 'Query is required.'}), 400

    try:
        # Generate query embedding
        query_embedding = embed_model.encode([f"search_query: {query}"])[0]
        query_vec = np.array(query_embedding).reshape(1, -1)

        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.embedding, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.embedding IS NOT NULL
        ''')

        results = []
        for row in cursor.fetchall():
            idea_vec = np.array(json.loads(row['embedding'])).reshape(1, -1)
            similarity = float(cosine_similarity(query_vec, idea_vec)[0][0])

            if similarity > 0.3:
                result = {
                    'id': row['id'],
                    'content': row['content'],
                    'timestamp': row['timestamp'],
                    'similarity': round(similarity, 3),
                    'category': None
                }
                if row['category_id']:
                    result['category'] = {
                        'id': row['category_id'],
                        'name': row['category_name'],
                        'color': row['category_color']
                    }
                results.append(result)

        conn.close()

        # Sort by similarity descending, top 20
        results.sort(key=lambda r: r['similarity'], reverse=True)
        return jsonify({'results': results[:20]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 5: Add POST /upload and GET /uploads/<filename>**

```python
ALLOWED_MIME_TYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm'
}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

def sanitize_filename(name):
    """Strip path separators and special chars, keep alphanumeric, hyphens, underscores, dots."""
    name = os.path.basename(name)
    name = re.sub(r'[^\w\-.]', '_', name)
    return name


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

    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        return jsonify({'error': f'File type {file.content_type} not allowed.'}), 400

    try:
        sanitized = sanitize_filename(file.filename)
        stored_filename = f"{idea_id}_{sanitized}"
        filepath = os.path.join('uploads', stored_filename)

        os.makedirs('uploads', exist_ok=True)
        file.save(filepath)
        file_size = os.path.getsize(filepath)

        # Determine media type
        media_type = 'image' if file.content_type.startswith('image/') else 'video'

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
    from flask import send_from_directory
    return send_from_directory('uploads', filename)
```

- [ ] **Step 6: Add category CRUD endpoints**

```python
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
        # Generate embedding for the category
        embedding = generate_embedding(name)

        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        cursor.execute('SELECT MAX(sort_order) FROM categories')
        max_order = cursor.fetchone()[0] or 0

        cursor.execute(
            'INSERT INTO categories (name, color, embedding, sort_order) VALUES (?, ?, ?, ?)',
            (name, color, json.dumps(embedding), max_order + 1)
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
            # Regenerate embedding if name changes
            embedding = generate_embedding(data['name'])
            updates.append('embedding = ?')
            values.append(json.dumps(embedding))
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
```

- [ ] **Step 7: Commit**

```bash
git add app.py
git commit -m "feat: add API endpoints for ideas CRUD, semantic search, file upload, categories"
```

---

## Task 4: Backend — Migration Script & Dockerfile

**Files:**
- Create: `migrate_embeddings.py`
- Create: `Dockerfile.api`

- [ ] **Step 1: Create migrate_embeddings.py**

```python
"""One-time migration: regenerate all idea embeddings with nomic model
and auto-categorize all ideas.

Usage: python migrate_embeddings.py
"""
import sqlite3
import json
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

DB_PATH = 'notes.db'

print("Loading nomic-embed-text-v1.5...")
model = SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)
print("Model loaded.")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Step 1: Get all category embeddings
cursor.execute("SELECT id, name, embedding FROM categories")
categories = cursor.fetchall()
cat_vecs = {}
for cat_id, cat_name, cat_emb in categories:
    if cat_emb:
        cat_vecs[cat_id] = np.array(json.loads(cat_emb))

# Step 2: Get all ideas
cursor.execute("SELECT id, content FROM ideas WHERE content IS NOT NULL AND content != ''")
ideas = cursor.fetchall()
print(f"Found {len(ideas)} ideas to process.")

# Step 3: Generate embeddings in batches
batch_size = 64
for i in range(0, len(ideas), batch_size):
    batch = ideas[i:i + batch_size]
    texts = [f"search_document: {content}" for _, content in batch]
    embeddings = model.encode(texts)

    for j, (idea_id, content) in enumerate(batch):
        emb = embeddings[j].tolist()
        emb_json = json.dumps(emb)

        # Find best category
        idea_vec = np.array(emb).reshape(1, -1)
        best_cat_id = None
        best_score = -1
        for cat_id, cat_vec in cat_vecs.items():
            score = cosine_similarity(idea_vec, cat_vec.reshape(1, -1))[0][0]
            if score > best_score:
                best_score = score
                best_cat_id = cat_id

        cursor.execute(
            "UPDATE ideas SET embedding = ?, category_id = ? WHERE id = ?",
            (emb_json, best_cat_id, idea_id)
        )

    conn.commit()
    print(f"Processed {min(i + batch_size, len(ideas))}/{len(ideas)}")

conn.close()
print("Migration complete.")
```

- [ ] **Step 2: Create Dockerfile.api**

```dockerfile
FROM python:3.13-slim
WORKDIR /app

# Install system deps for sentence-transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the nomic model at build time so startup is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)"

COPY . .

RUN mkdir -p /app/uploads
```

- [ ] **Step 3: Commit**

```bash
git add migrate_embeddings.py Dockerfile.api
git commit -m "feat: add embedding migration script and Flask Dockerfile"
```

---

## Task 5: Frontend — Project Scaffold & Configuration

**Files:**
- Create: `frontend/` directory with Next.js project
- Create: `frontend/next.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/lib/types.ts`
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /home/ardi/Projects/think_tank
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --no-turbopack
```

- [ ] **Step 2: Install dependencies**

```bash
cd frontend
npm install swr fuse.js framer-motion react-sketch-canvas browser-image-compression react-window lucide-react sonner
npm install -D @types/react-window
npx shadcn@latest init -d
npx shadcn@latest add drawer button input badge tabs dialog skeleton sonner
```

Note: React Bits components are copy-paste from reactbits.dev, not an npm package. They will be added as local components in later tasks.

- [ ] **Step 3: Configure next.config.ts with API proxy rewrites**

Replace `frontend/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/flask/:path*",
        destination: `${process.env.API_URL || "http://localhost:6000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create TypeScript types**

Create `frontend/lib/types.ts`:

```typescript
export interface IdeaMedia {
  id: number;
  filename: string;
  media_type: "image" | "sketch" | "video";
  file_size: number;
  url: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface Idea {
  id: number;
  content: string;
  timestamp: string;
  media_type: "text" | "image" | "sketch" | "video" | "mixed";
  has_media: boolean;
  category: Category | null;
  media: IdeaMedia[];
}

export interface SearchResult {
  id: number;
  content: string;
  timestamp: string;
  similarity: number;
  category: Category | null;
}

export type ThemeName = "minimal-dark" | "soft-neutral" | "glass-modern";
```

- [ ] **Step 5: Create theme CSS variables**

Replace `frontend/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root,
[data-theme="minimal-dark"] {
  --background: #0a0a0a;
  --foreground: #fafafa;
  --card: #141414;
  --card-border: #1a1a1a;
  --muted: #555555;
  --accent: #fafafa;
  --input: #1a1a1a;
  --ring: #fafafa;
}

[data-theme="soft-neutral"] {
  --background: #f8f7f4;
  --foreground: #1a1a1a;
  --card: #ffffff;
  --card-border: #e8e6e1;
  --muted: #999999;
  --accent: #1a1a1a;
  --input: #e8e6e1;
  --ring: #1a1a1a;
}

[data-theme="glass-modern"] {
  --background: #0f0f1a;
  --foreground: #e0e0e0;
  --card: rgba(255, 255, 255, 0.05);
  --card-border: rgba(255, 255, 255, 0.08);
  --muted: #666666;
  --accent: #a78bfa;
  --input: rgba(255, 255, 255, 0.08);
  --ring: #a78bfa;
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 6: Create root layout**

Replace `frontend/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Think Tank",
  description: "Personal idea capture",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create theme provider**

Create `frontend/components/theme/theme-provider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeName } from "@/lib/types";

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "minimal-dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>("minimal-dark");

  useEffect(() => {
    const saved = localStorage.getItem("think-tank-theme") as ThemeName | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("think-tank-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 8: Create frontend Dockerfile**

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 9: Verify the scaffold builds**

```bash
cd /home/ardi/Projects/think_tank/frontend
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 10: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: scaffold Next.js frontend with types, themes, API proxy, Dockerfile"
```

---

## Task 6: Frontend — Authentication (Password Gate)

**Files:**
- Create: `frontend/middleware.ts`
- Create: `frontend/app/api/auth/route.ts`
- Create: `frontend/app/login/page.tsx`
- Create: `frontend/components/auth/password-gate.tsx`

- [ ] **Step 1: Create auth API route**

Create `frontend/app/api/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

const PASSWORD = process.env.THINK_TANK_PASSWORD || "changeme";
const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";

function signToken(): string {
  const payload = Date.now().toString();
  const hmac = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export function verifyToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (password !== PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = signToken();
  const response = NextResponse.json({ success: true });

  (await cookies()).set("think_tank_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return response;
}
```

- [ ] **Step 2: Create middleware for auth check**

Create `frontend/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.COOKIE_SECRET || "default-secret-change-me";

async function verifyToken(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;

  // Use Web Crypto API (available in Edge Runtime)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === sig;
}

export async function middleware(request: NextRequest) {
  // Skip auth for login page and auth API
  if (
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/api/auth") ||
    request.nextUrl.pathname.startsWith("/api/flask")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("think_tank_auth");

  if (!token || !(await verifyToken(token.value))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: Create password gate component**

Create `frontend/components/auth/password-gate.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PasswordGate() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong password");
      setPassword("");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <h1 className="text-2xl font-bold text-center"
            style={{ color: "var(--foreground)" }}>
          think tank
        </h1>
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="text-center"
        />
        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "..." : "Enter"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create login page**

Create `frontend/app/login/page.tsx`:

```tsx
import { PasswordGate } from "@/components/auth/password-gate";

export default function LoginPage() {
  return <PasswordGate />;
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
cd /home/ardi/Projects/think_tank/frontend
npm run build
```

- [ ] **Step 6: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add password gate authentication with signed cookie"
```

---

## Task 7: Frontend — API Client & Data Hooks

**Files:**
- Create: `frontend/lib/api.ts`
- Create: `frontend/lib/hooks/use-ideas.ts`
- Create: `frontend/lib/hooks/use-categories.ts`
- Create: `frontend/lib/hooks/use-search.ts`
- Create: `frontend/lib/hooks/use-upload.ts`
- Create: `frontend/lib/utils/dates.ts`
- Create: `frontend/lib/utils/compress.ts`

- [ ] **Step 1: Create API client**

Create `frontend/lib/api.ts`:

```typescript
const API_BASE = "/api/flask";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchIdeas() {
  const res = await fetch(`${API_BASE}/ideas`);
  return handleResponse<{ ideas: import("./types").Idea[]; total: number }>(res);
}

export async function createIdea(content: string, categoryId?: number) {
  const res = await fetch(`${API_BASE}/ideas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, category_id: categoryId }),
  });
  return handleResponse<{ id: number; message: string }>(res);
}

export async function updateIdea(id: number, data: { content?: string; category_id?: number }) {
  const res = await fetch(`${API_BASE}/ideas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

export async function deleteIdea(id: number) {
  const res = await fetch(`${API_BASE}/ideas/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}

export async function searchIdeas(query: string) {
  const res = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return handleResponse<{ results: import("./types").SearchResult[] }>(res);
}

export async function uploadFile(ideaId: number, file: File) {
  const formData = new FormData();
  formData.append("idea_id", ideaId.toString());
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<{ id: number; filename: string; url: string }>(res);
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/categories`);
  return handleResponse<{ categories: import("./types").Category[] }>(res);
}

export async function createCategory(name: string, color: string) {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return handleResponse<{ id: number; message: string }>(res);
}

export async function updateCategory(id: number, data: { name?: string; color?: string }) {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

export async function deleteCategory(id: number) {
  const res = await fetch(`${API_BASE}/categories/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}
```

- [ ] **Step 2: Create use-ideas hook**

Create `frontend/lib/hooks/use-ideas.ts`:

```typescript
import useSWR from "swr";
import { fetchIdeas, createIdea, deleteIdea, updateIdea } from "@/lib/api";
import type { Idea } from "@/lib/types";

export function useIdeas() {
  const { data, error, isLoading, mutate } = useSWR("ideas", () => fetchIdeas());

  const ideas = data?.ideas ?? [];

  const addIdea = async (content: string, categoryId?: number) => {
    // Optimistic update
    const tempId = -Date.now();
    const optimistic: Idea = {
      id: tempId,
      content,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      media_type: "text",
      has_media: false,
      category: null,
      media: [],
    };

    mutate(
      async () => {
        const result = await createIdea(content, categoryId);
        return fetchIdeas();
      },
      {
        optimisticData: { ideas: [optimistic, ...ideas], total: ideas.length + 1 },
        rollbackOnError: true,
      }
    );
  };

  const removeIdea = async (id: number) => {
    mutate(
      async () => {
        await deleteIdea(id);
        return fetchIdeas();
      },
      {
        optimisticData: {
          ideas: ideas.filter((i) => i.id !== id),
          total: ideas.length - 1,
        },
        rollbackOnError: true,
      }
    );
  };

  const patchIdea = async (id: number, data: { content?: string; category_id?: number }) => {
    await updateIdea(id, data);
    mutate();
  };

  return { ideas, isLoading, error, mutate, addIdea, removeIdea, patchIdea };
}
```

- [ ] **Step 3: Create use-categories hook**

Create `frontend/lib/hooks/use-categories.ts`:

```typescript
import useSWR from "swr";
import { fetchCategories } from "@/lib/api";

export function useCategories() {
  const { data, error, isLoading, mutate } = useSWR("categories", () => fetchCategories());

  return {
    categories: data?.categories ?? [],
    isLoading,
    error,
    mutate,
  };
}
```

- [ ] **Step 4: Create use-search hook**

Create `frontend/lib/hooks/use-search.ts`:

```typescript
import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import { searchIdeas } from "@/lib/api";
import type { Idea, SearchResult } from "@/lib/types";

export function useSearch(ideas: Idea[]) {
  const [query, setQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
  const [isSearchingDeep, setIsSearchingDeep] = useState(false);
  const [mode, setMode] = useState<"fuzzy" | "semantic">("fuzzy");

  const fuse = useMemo(
    () =>
      new Fuse(ideas, {
        keys: ["content"],
        threshold: 0.4,
        includeScore: true,
      }),
    [ideas]
  );

  const fuzzyResults = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query).map((r) => r.item);
  }, [fuse, query]);

  const triggerDeepSearch = async () => {
    if (!query.trim()) return;
    setIsSearchingDeep(true);
    setMode("semantic");
    try {
      const { results } = await searchIdeas(query);
      setSemanticResults(results);
    } catch (e) {
      console.error("Semantic search failed:", e);
    } finally {
      setIsSearchingDeep(false);
    }
  };

  const updateQuery = (q: string) => {
    setQuery(q);
    setMode("fuzzy");
    setSemanticResults([]);
  };

  return {
    query,
    setQuery: updateQuery,
    fuzzyResults,
    semanticResults,
    isSearchingDeep,
    mode,
    triggerDeepSearch,
  };
}
```

- [ ] **Step 5: Create use-upload hook**

Create `frontend/lib/hooks/use-upload.ts`:

```typescript
import { useState } from "react";
import { uploadFile } from "@/lib/api";
import imageCompression from "browser-image-compression";

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  initialQuality: 0.8,
};

export function useUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = async (ideaId: number, files: File[]) => {
    setUploading(true);
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          let processedFile = file;

          // Compress images client-side before upload
          if (file.type.startsWith("image/")) {
            processedFile = await imageCompression(file, COMPRESSION_OPTIONS);
          }

          return uploadFile(ideaId, processedFile);
        })
      );
      return results;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}
```

- [ ] **Step 6: Create date utility**

Create `frontend/lib/utils/dates.ts`:

```typescript
import type { Idea } from "@/lib/types";

export function formatDate(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function groupByDate(ideas: Idea[]): Map<string, Idea[]> {
  const groups = new Map<string, Idea[]>();
  for (const idea of ideas) {
    const dateKey = idea.timestamp.split(" ")[0]; // "YYYY-MM-DD"
    const existing = groups.get(dateKey) || [];
    existing.push(idea);
    groups.set(dateKey, existing);
  }
  return groups;
}
```

- [ ] **Step 7: Create compress utility**

Create `frontend/lib/utils/compress.ts`:

```typescript
import imageCompression from "browser-image-compression";

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  return imageCompression(file, {
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    initialQuality: 0.8,
  });
}
```

- [ ] **Step 8: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add API client, SWR data hooks, fuzzy+semantic search, upload with compression"
```

---

## Task 8: Frontend — Layout Shell (Header, Bottom Nav, FAB)

**Files:**
- Create: `frontend/components/layout/header.tsx`
- Create: `frontend/components/layout/bottom-nav.tsx`
- Create: `frontend/components/layout/fab.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create header component**

Create `frontend/components/layout/header.tsx`:

```tsx
"use client";

import { Settings } from "lucide-react";

export function Header({ onSettingsClick }: { onSettingsClick: () => void }) {
  return (
    <header className="flex items-center justify-between px-4 py-3 sticky top-0 z-40"
            style={{ backgroundColor: "var(--background)" }}>
      <h1 className="text-xl font-bold tracking-tight"
          style={{
            background: "linear-gradient(135deg, var(--foreground), var(--muted))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
        think tank
      </h1>
      <button
        onClick={onSettingsClick}
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--card-border)" }}
      >
        <Settings size={16} style={{ color: "var(--muted)" }} />
      </button>
    </header>
  );
}
```

- [ ] **Step 2: Create bottom nav component**

Create `frontend/components/layout/bottom-nav.tsx`:

```tsx
"use client";

export type TabName = "ideas" | "search" | "categories";

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

const tabs: { name: TabName; icon: string; label: string }[] = [
  { name: "ideas", icon: "💡", label: "Ideas" },
  { name: "search", icon: "🔍", label: "Search" },
  { name: "categories", icon: "📂", label: "Categories" },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-around pb-5 pt-2"
      style={{
        backgroundColor: "var(--background)",
        borderTop: "1px solid var(--card-border)",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.name}
          onClick={() => onTabChange(tab.name)}
          className="flex flex-col items-center gap-0.5 px-4 py-1"
        >
          <span className="text-lg">{tab.icon}</span>
          <span
            className="text-[10px] font-medium"
            style={{
              color: activeTab === tab.name ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {tab.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create FAB component**

Create `frontend/components/layout/fab.tsx`:

```tsx
"use client";

interface FabProps {
  onClick: () => void;
}

export function Fab({ onClick }: FabProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-light shadow-lg active:scale-95 transition-transform"
      style={{
        background: "linear-gradient(135deg, var(--foreground), var(--muted))",
        color: "var(--background)",
      }}
    >
      +
    </button>
  );
}
```

- [ ] **Step 4: Create main page with tab layout**

Replace `frontend/app/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { Fab } from "@/components/layout/fab";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen pb-20">
      <Header onSettingsClick={() => setSettingsOpen(true)} />

      <main className="px-4">
        {activeTab === "ideas" && (
          <div className="text-center py-20" style={{ color: "var(--muted)" }}>
            Ideas tab — coming next
          </div>
        )}
        {activeTab === "search" && (
          <div className="text-center py-20" style={{ color: "var(--muted)" }}>
            Search tab — coming next
          </div>
        )}
        {activeTab === "categories" && (
          <div className="text-center py-20" style={{ color: "var(--muted)" }}>
            Categories tab — coming next
          </div>
        )}
      </main>

      <Fab onClick={() => setCaptureOpen(true)} />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

- [ ] **Step 5: Install lucide-react for icons**

```bash
cd /home/ardi/Projects/think_tank/frontend
npm install lucide-react
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add layout shell — header with gradient text, bottom nav, FAB button"
```

---

## Task 9: Frontend — Ideas Feed (Virtualized List with Cards)

**Files:**
- Create: `frontend/components/ideas/idea-feed.tsx`
- Create: `frontend/components/ideas/idea-card.tsx`
- Create: `frontend/components/categories/category-badge.tsx`
- Create: `frontend/components/categories/category-filter.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create category badge**

Create `frontend/components/categories/category-badge.tsx`:

```tsx
interface CategoryBadgeProps {
  name: string;
  color: string;
}

export function CategoryBadge({ name, color }: CategoryBadgeProps) {
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}33`,
      }}
    >
      {name}
    </span>
  );
}
```

- [ ] **Step 2: Create idea card**

Create `frontend/components/ideas/idea-card.tsx`:

```tsx
"use client";

import { memo } from "react";
import type { Idea } from "@/lib/types";
import { CategoryBadge } from "@/components/categories/category-badge";
import { formatTime } from "@/lib/utils/dates";

interface IdeaCardProps {
  idea: Idea;
  onClick?: () => void;
}

export const IdeaCard = memo(function IdeaCard({ idea, onClick }: IdeaCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3.5 rounded-xl transition-colors"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--card-border)",
      }}
    >
      {idea.content && (
        <p className="text-sm leading-relaxed mb-2" style={{ color: "var(--foreground)" }}>
          {idea.content}
        </p>
      )}

      {idea.has_media && idea.media.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto">
          {idea.media.map((m) =>
            m.media_type === "video" ? (
              <div
                key={m.id}
                className="w-20 h-20 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl"
                style={{ backgroundColor: "var(--card-border)" }}
              >
                🎥
              </div>
            ) : (
              <img
                key={m.id}
                src={m.url}
                alt=""
                className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
              />
            )
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {idea.category ? (
          <CategoryBadge name={idea.category.name} color={idea.category.color} />
        ) : (
          <span />
        )}
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {formatTime(idea.timestamp)}
        </span>
      </div>
    </button>
  );
});
```

- [ ] **Step 3: Create category filter pills**

Create `frontend/components/categories/category-filter.tsx`:

```tsx
"use client";

import type { Category } from "@/lib/types";

interface CategoryFilterProps {
  categories: Category[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className="px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
        style={{
          backgroundColor: selected === null ? "var(--foreground)" : "var(--card)",
          color: selected === null ? "var(--background)" : "var(--muted)",
          border: selected === null ? "none" : "1px solid var(--card-border)",
        }}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className="px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
          style={{
            backgroundColor: selected === cat.id ? "var(--foreground)" : "var(--card)",
            color: selected === cat.id ? "var(--background)" : "var(--muted)",
            border: selected === cat.id ? "none" : "1px solid var(--card-border)",
          }}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create idea feed (virtualized)**

Create `frontend/components/ideas/idea-feed.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Idea } from "@/lib/types";
import { IdeaCard } from "./idea-card";
import { CategoryFilter } from "@/components/categories/category-filter";
import { useCategories } from "@/lib/hooks/use-categories";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";

interface IdeaFeedProps {
  ideas: Idea[];
  isLoading: boolean;
}

export function IdeaFeed({ ideas, isLoading }: IdeaFeedProps) {
  const { categories } = useCategories();
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const filteredIdeas = useMemo(() => {
    if (selectedCategory === null) return ideas;
    return ideas.filter((i) => i.category?.id === selectedCategory);
  }, [ideas, selectedCategory]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { date: string; label: string; ideas: Idea[] }[] = [];
    let currentDate = "";

    for (const idea of filteredIdeas) {
      const dateKey = idea.timestamp.split(" ")[0];
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({
          date: dateKey,
          label: formatDate(idea.timestamp),
          ideas: [],
        });
      }
      groups[groups.length - 1].ideas.push(idea);
    }

    return groups;
  }, [filteredIdeas]);

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <CategoryFilter
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />

      {filteredIdeas.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--muted)" }}>
          {selectedCategory ? "No ideas in this category" : "No ideas yet. Tap + to add one!"}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.date}>
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--muted)" }}
              >
                {group.label}
              </p>
              <div className="space-y-2">
                {group.ideas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: Starting without react-window for simplicity. If scrolling performance becomes an issue with 500+ ideas rendered, wrap the list in a FixedSizeList. The grouped-by-date layout makes virtualizing non-trivial (variable height rows), so we'll add it as an optimization if needed.

- [ ] **Step 5: Wire ideas feed into main page**

Update `frontend/app/page.tsx` — replace the ideas placeholder:

```tsx
"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { Fab } from "@/components/layout/fab";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { useIdeas } from "@/lib/hooks/use-ideas";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { ideas, isLoading } = useIdeas();

  return (
    <div className="min-h-screen pb-20">
      <Header onSettingsClick={() => setSettingsOpen(true)} />

      <main className="px-4">
        {activeTab === "ideas" && (
          <IdeaFeed ideas={ideas} isLoading={isLoading} />
        )}
        {activeTab === "search" && (
          <div className="text-center py-20" style={{ color: "var(--muted)" }}>
            Search tab — coming next
          </div>
        )}
        {activeTab === "categories" && (
          <div className="text-center py-20" style={{ color: "var(--muted)" }}>
            Categories tab — coming next
          </div>
        )}
      </main>

      <Fab onClick={() => setCaptureOpen(true)} />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add ideas feed with cards, category badges, date grouping, and filter pills"
```

---

## Task 10: Frontend — Capture Sheet (Bottom Sheet + Media Upload)

**Files:**
- Create: `frontend/components/ideas/capture-sheet.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create capture sheet**

Create `frontend/components/ideas/capture-sheet.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/lib/hooks/use-categories";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useUpload } from "@/lib/hooks/use-upload";
import { createIdea } from "@/lib/api";
import { Camera, Pencil, Video } from "lucide-react";
import { toast } from "sonner";

interface CaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSketchOpen: () => void;
  sketchBlob: Blob | null;
  clearSketch: () => void;
}

export function CaptureSheet({
  open,
  onOpenChange,
  onSketchOpen,
  sketchBlob,
  clearSketch,
}: CaptureSheetProps) {
  const [content, setContent] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { categories } = useCategories();
  const { mutate } = useIdeas();
  const { upload, uploading } = useUpload();
  // toast imported from "sonner" at top of file

  const handleSave = async () => {
    if (!content.trim() && files.length === 0 && !sketchBlob) return;

    setSaving(true);
    try {
      const result = await createIdea(content, selectedCategory);
      const ideaId = result.id;

      // Upload files + sketch in parallel
      const allFiles = [...files];
      if (sketchBlob) {
        allFiles.push(new File([sketchBlob], "sketch.png", { type: "image/png" }));
      }

      if (allFiles.length > 0) {
        try {
          await upload(ideaId, allFiles);
        } catch {
          toast.error("Idea saved but media upload failed.");
        }
      }

      // Reset form
      setContent("");
      setSelectedCategory(undefined);
      setFiles([]);
      clearSketch();
      onOpenChange(false);
      mutate();
    } catch {
      toast.error("Failed to save idea.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>New Idea</DrawerTitle>
        </DrawerHeader>
        <div className="px-5 pb-8 space-y-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            autoFocus
            rows={3}
            className="w-full resize-none rounded-lg p-3 text-sm outline-none"
            style={{
              backgroundColor: "var(--input)",
              color: "var(--foreground)",
              border: "1px solid var(--card-border)",
            }}
          />

          {/* Media buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Camera size={20} style={{ color: "var(--muted)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted)" }}>Photo</span>
            </button>
            <button
              onClick={onSketchOpen}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Pencil size={20} style={{ color: "var(--muted)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted)" }}>Sketch</span>
            </button>
            <button
              onClick={() => videoInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-lg"
              style={{ backgroundColor: "var(--input)" }}
            >
              <Video size={20} style={{ color: "var(--muted)" }} />
              <span className="text-[10px]" style={{ color: "var(--muted)" }}>Video</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Preview attached files */}
          {(files.length > 0 || sketchBlob) && (
            <div className="flex gap-2 overflow-x-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="w-16 h-16 rounded-lg flex-shrink-0 flex items-center justify-center text-xs relative"
                  style={{ backgroundColor: "var(--card-border)" }}
                >
                  {f.type.startsWith("image/") ? "🖼" : "🎥"}
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted)", color: "var(--background)" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {sketchBlob && (
                <div
                  className="w-16 h-16 rounded-lg flex-shrink-0 flex items-center justify-center text-xs relative"
                  style={{ backgroundColor: "var(--card-border)" }}
                >
                  ✏️
                  <button
                    onClick={clearSketch}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center"
                    style={{ backgroundColor: "var(--muted)", color: "var(--background)" }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Category chips */}
          <div>
            <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Category
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() =>
                    setSelectedCategory(selectedCategory === cat.id ? undefined : cat.id)
                  }
                  className="px-3 py-1.5 rounded-full text-[11px] font-medium"
                  style={{
                    backgroundColor:
                      selectedCategory === cat.id ? `${cat.color}30` : "var(--input)",
                    color: selectedCategory === cat.id ? cat.color : "var(--muted)",
                    border:
                      selectedCategory === cat.id
                        ? `1px solid ${cat.color}50`
                        : "1px solid var(--card-border)",
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || uploading || (!content.trim() && files.length === 0 && !sketchBlob)}
            className="w-full rounded-xl py-6 text-base font-semibold"
          >
            {saving || uploading ? "Saving..." : "Save Idea"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 2: Wire capture sheet into main page**

Update `frontend/app/page.tsx` to add CaptureSheet with sketch state:

Add imports and state for capture sheet, then render it. The sketch pad will be wired in the next task.

- [ ] **Step 3: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add capture bottom sheet with text, photo, video upload, category selection"
```

---

## Task 11: Frontend — Sketch Pad

**Files:**
- Create: `frontend/components/sketch/sketch-pad.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create sketch pad component**

Create `frontend/components/sketch/sketch-pad.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { ReactSketchCanvas, type ReactSketchCanvasRef } from "react-sketch-canvas";
import { Button } from "@/components/ui/button";
import { Undo2, Trash2, X } from "lucide-react";

interface SketchPadProps {
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void;
}

const COLORS = ["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

export function SketchPad({ open, onClose, onSave }: SketchPadProps) {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3);

  if (!open) return null;

  const handleSave = async () => {
    if (!canvasRef.current) return;
    const dataUrl = await canvasRef.current.exportImage("png");
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    onSave(blob);
    canvasRef.current.clearCanvas();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ backgroundColor: "var(--background)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose}>
          <X size={24} style={{ color: "var(--foreground)" }} />
        </button>
        <span className="font-semibold" style={{ color: "var(--foreground)" }}>
          Sketch
        </span>
        <Button onClick={handleSave} size="sm">
          Done
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactSketchCanvas
          ref={canvasRef}
          strokeWidth={strokeWidth}
          strokeColor={strokeColor}
          canvasColor="transparent"
          style={{ border: "none" }}
          allowOnlyPointerType="all"
        />
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-3 pb-8"
        style={{ borderTop: "1px solid var(--card-border)" }}
      >
        <div className="flex gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setStrokeColor(color)}
              className="w-7 h-7 rounded-full"
              style={{
                backgroundColor: color,
                border: strokeColor === color ? "2px solid var(--accent)" : "2px solid transparent",
                outline: strokeColor === color ? "2px solid var(--background)" : "none",
              }}
            />
          ))}
        </div>
        <div className="flex gap-3">
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20"
          />
          <button onClick={() => canvasRef.current?.undo()}>
            <Undo2 size={20} style={{ color: "var(--muted)" }} />
          </button>
          <button onClick={() => canvasRef.current?.clearCanvas()}>
            <Trash2 size={20} style={{ color: "var(--muted)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire sketch pad into main page**

Update `frontend/app/page.tsx` to manage sketch state and connect it to capture sheet:

```tsx
// Add to state:
const [sketchOpen, setSketchOpen] = useState(false);
const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);

// Add to JSX (alongside CaptureSheet):
<SketchPad
  open={sketchOpen}
  onClose={() => setSketchOpen(false)}
  onSave={(blob) => setSketchBlob(blob)}
/>

// Pass to CaptureSheet:
<CaptureSheet
  open={captureOpen}
  onOpenChange={setCaptureOpen}
  onSketchOpen={() => setSketchOpen(true)}
  sketchBlob={sketchBlob}
  clearSketch={() => setSketchBlob(null)}
/>
```

- [ ] **Step 3: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add sketch pad with Apple Pencil support, color picker, undo"
```

---

## Task 12: Frontend — Search Tab

**Files:**
- Create: `frontend/components/search/search-bar.tsx`
- Create: `frontend/components/search/search-results.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create search bar**

Create `frontend/components/search/search-bar.tsx`:

```tsx
"use client";

import { Search } from "lucide-react";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onDeepSearch: () => void;
  isSearchingDeep: boolean;
}

export function SearchBar({ query, onQueryChange, onDeepSearch, isSearchingDeep }: SearchBarProps) {
  return (
    <div className="relative mb-4">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2.5"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--card-border)",
        }}
      >
        <Search size={16} style={{ color: "var(--muted)" }} />
        <input
          type="text"
          placeholder="Search ideas..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onDeepSearch();
          }}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "var(--foreground)" }}
        />
        {query.trim() && (
          <button
            onClick={onDeepSearch}
            disabled={isSearchingDeep}
            className="text-xs font-medium px-2.5 py-1 rounded-md"
            style={{
              backgroundColor: "var(--card-border)",
              color: "var(--foreground)",
            }}
          >
            {isSearchingDeep ? "..." : "Deep"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create search results**

Create `frontend/components/search/search-results.tsx`:

```tsx
"use client";

import type { Idea, SearchResult } from "@/lib/types";
import { IdeaCard } from "@/components/ideas/idea-card";
import { CategoryBadge } from "@/components/categories/category-badge";
import { formatTime } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";

interface SearchResultsProps {
  mode: "fuzzy" | "semantic";
  fuzzyResults: Idea[];
  semanticResults: SearchResult[];
  isSearchingDeep: boolean;
  query: string;
}

export function SearchResults({
  mode,
  fuzzyResults,
  semanticResults,
  isSearchingDeep,
  query,
}: SearchResultsProps) {
  if (!query.trim()) {
    return (
      <div className="text-center py-20" style={{ color: "var(--muted)" }}>
        Search your ideas — type to search instantly, press Enter for deep semantic search
      </div>
    );
  }

  if (isSearchingDeep) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (mode === "semantic" && semanticResults.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
          Semantic results
        </p>
        {semanticResults.map((result) => (
          <div
            key={result.id}
            className="p-3.5 rounded-xl"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--card-border)",
            }}
          >
            <p className="text-sm mb-2" style={{ color: "var(--foreground)" }}>
              {result.content}
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.category && (
                  <CategoryBadge name={result.category.name} color={result.category.color} />
                )}
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--card-border)",
                    color: "var(--foreground)",
                  }}
                >
                  {Math.round(result.similarity * 100)}% match
                </span>
              </div>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {formatTime(result.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (fuzzyResults.length > 0) {
    return (
      <div className="space-y-2">
        {fuzzyResults.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
    );
  }

  return (
    <div className="text-center py-20" style={{ color: "var(--muted)" }}>
      No results found. Try a different search or press Enter for deep search.
    </div>
  );
}
```

- [ ] **Step 3: Wire search tab into main page**

Update the search tab in `frontend/app/page.tsx`:

```tsx
// Add import:
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { useSearch } from "@/lib/hooks/use-search";

// Inside Home component:
const search = useSearch(ideas);

// In JSX, replace search placeholder:
{activeTab === "search" && (
  <>
    <SearchBar
      query={search.query}
      onQueryChange={search.setQuery}
      onDeepSearch={search.triggerDeepSearch}
      isSearchingDeep={search.isSearchingDeep}
    />
    <SearchResults
      mode={search.mode}
      fuzzyResults={search.fuzzyResults}
      semanticResults={search.semanticResults}
      isSearchingDeep={search.isSearchingDeep}
      query={search.query}
    />
  </>
)}
```

- [ ] **Step 4: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add search tab with instant fuzzy search and semantic deep search"
```

---

## Task 13: Frontend — Categories Tab & Settings

**Files:**
- Create: `frontend/components/categories/category-manager.tsx`
- Create: `frontend/components/theme/theme-selector.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create categories tab view**

Create `frontend/components/categories/category-manager.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useCategories } from "@/lib/hooks/use-categories";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { createCategory, deleteCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function CategoryManager() {
  const { categories, mutate } = useCategories();
  const { ideas } = useIdeas();
  // toast imported from "sonner" at top of file
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#71717a");

  const getIdeaCount = (catId: number) =>
    ideas.filter((i) => i.category?.id === catId).length;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await createCategory(newName, newColor);
      setNewName("");
      mutate();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (name === "Misc") return; // Don't delete Misc
    try {
      await deleteCategory(id);
      mutate();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between p-3 rounded-xl"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--card-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-sm" style={{ color: "var(--foreground)" }}>
                {cat.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {getIdeaCount(cat.id)}
              </span>
              {cat.name !== "Misc" && (
                <button onClick={() => handleDelete(cat.id, cat.name)}>
                  <Trash2 size={14} style={{ color: "var(--muted)" }} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add new category */}
      <div className="flex gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer border-0"
        />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="flex-1"
        />
        <Button onClick={handleAdd} size="icon">
          <Plus size={16} />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create theme selector**

Create `frontend/components/theme/theme-selector.tsx`:

```tsx
"use client";

import { useTheme } from "@/components/theme/theme-provider";
import type { ThemeName } from "@/lib/types";

const themes: { name: ThemeName; label: string }[] = [
  { name: "minimal-dark", label: "Minimal Dark" },
  { name: "soft-neutral", label: "Soft Neutral" },
  { name: "glass-modern", label: "Glass Modern" },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        Theme
      </p>
      <div className="flex gap-2">
        {themes.map((t) => (
          <button
            key={t.name}
            onClick={() => setTheme(t.name)}
            className="flex-1 py-2.5 rounded-lg text-xs font-medium"
            style={{
              backgroundColor: theme === t.name ? "var(--foreground)" : "var(--card)",
              color: theme === t.name ? "var(--background)" : "var(--muted)",
              border: theme === t.name ? "none" : "1px solid var(--card-border)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire categories tab and settings dialog into main page**

Update `frontend/app/page.tsx`:
- Categories tab shows `CategoryManager`
- Settings dialog (triggered by header gear icon) contains `ThemeSelector`
- Use shadcn `Dialog` for settings

- [ ] **Step 4: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/
git commit -m "feat: add categories tab with CRUD, theme selector in settings dialog"
```

---

## Task 14: Docker Compose & Deployment

**Files:**
- Modify: `docker-compose.yml`
- Modify: `deploy.sh`
- Modify: `.env`

- [ ] **Step 1: Update docker-compose.yml**

Replace `docker-compose.yml`:

```yaml
services:
  flask:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: think_tank_api
    command: gunicorn -b 0.0.0.0:6000 -w 1 --threads 4 --preload app:app
    ports:
      - "6000:6000"
    volumes:
      - /home/ardi/think_tank/notes.db:/app/notes.db
      - /home/ardi/think_tank/uploads:/app/uploads
    environment:
      - MAIL_SERVER=${MAIL_SERVER}
      - MAIL_PORT=${MAIL_PORT}
      - MAIL_USE_TLS=${MAIL_USE_TLS}
      - MAIL_USERNAME=${MAIL_USERNAME}
      - MAIL_PASSWORD=${MAIL_PASSWORD}
      - MAIL_DEFAULT_SENDER=${MAIL_DEFAULT_SENDER}
    restart: always

  nextjs:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: think_tank_frontend
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://flask:6000
      - THINK_TANK_PASSWORD=${THINK_TANK_PASSWORD}
      - COOKIE_SECRET=${COOKIE_SECRET}
    depends_on:
      - flask
    restart: always
```

- [ ] **Step 2: Update deploy.sh**

```bash
#!/bin/bash
cd /home/ardi/think_tank
docker build -t think_tank_api -f Dockerfile.api .
docker build -t think_tank_frontend -f frontend/Dockerfile frontend/
docker compose up -d --force-recreate
docker compose ps
```

- [ ] **Step 3: Add new env vars to .env**

Append to `.env`:
```
THINK_TANK_PASSWORD=your-password-here
COOKIE_SECRET=generate-a-random-string-here
```

- [ ] **Step 4: Create uploads directory on host**

```bash
mkdir -p /home/ardi/think_tank/uploads
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml deploy.sh .env
git commit -m "feat: update Docker Compose for two-container setup, add deploy script"
```

---

## Task 15: Integration Testing & Cleanup

**Files:**
- Modify: `healthcheck.py`
- Modify: `send_daily_email.py`

- [ ] **Step 1: Build and start the full stack locally**

```bash
cd /home/ardi/Projects/think_tank
# Start Flask in dev mode
python app.py &

# Start Next.js in dev mode
cd frontend
API_URL=http://localhost:6000 THINK_TANK_PASSWORD=test COOKIE_SECRET=test-secret npm run dev &
```

- [ ] **Step 2: Test each flow manually**

1. Open `http://localhost:3000` — should redirect to `/login`
2. Enter password — should redirect to `/` and show ideas feed
3. Tap `+` → bottom sheet opens → type text → save → idea appears in feed
4. Go to Search tab → type a query → fuzzy results appear → press Enter → deep results appear
5. Go to Categories tab → see categories with counts → add a new one
6. Open Settings → switch themes → UI updates
7. Test iPhone Shortcut still works: `curl -X POST http://localhost:6000/add_note -H "Content-Type: application/json" -d '{"content":"test from curl"}'`

- [ ] **Step 3: Update healthcheck.py**

Change container names from `think_tank-streamlit-1` to `think_tank_frontend`.

- [ ] **Step 4: Update send_daily_email.py**

Remove the "Top 5 Tasks" section. Keep "Today's Ideas". Optionally add category labels.

- [ ] **Step 5: Run migrate_embeddings.py**

```bash
python migrate_embeddings.py
```

Verify: `sqlite3 notes.db "SELECT id, category_id FROM ideas LIMIT 5"` — should show category_id populated.

- [ ] **Step 6: Final commit**

```bash
git add healthcheck.py send_daily_email.py
git commit -m "chore: update healthcheck and daily email for new container setup"
```

---

## Task 16: React Bits Effects (Polish)

**Files:**
- Multiple component files (add effects incrementally)

This task is optional polish — do it after the core app works.

- [ ] **Step 1: Add aurora background to login page**

Copy the Aurora component from reactbits.dev into `frontend/components/ui/aurora.tsx`. Apply it as background to the login page.

- [ ] **Step 2: Add spotlight cursor effect to idea cards**

Copy the Spotlight component from reactbits.dev. Wrap idea cards with it for desktop hover glow.

- [ ] **Step 3: Add magnet effect to FAB**

Copy the Magnet component from reactbits.dev. Wrap the FAB button.

- [ ] **Step 4: Add count-up animation to category view**

Copy the CountUp component from reactbits.dev. Use it for idea counts in the categories tab.

- [ ] **Step 5: Add Framer Motion page transitions**

Add `AnimatePresence` and `motion.div` wrappers around tab content for smooth transitions on tab switch.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: add React Bits effects — aurora, spotlight, magnet, count-up, transitions"
```
