# Think Tank

Personal idea capture and to-do tracker with a Streamlit UI, Flask API, semantic search, and daily email digests.

## Architecture

```
                  ┌───────────────┐
  iOS Shortcut ──▶│  Flask API    │
                  │  :6000        │
                  └──────┬────────┘
                         │
                  ┌──────┴────────┐
                  │  Streamlit UI │──▶ OpenAI Embeddings
                  │  :8502        │    (semantic search)
                  └──────┬────────┘
                         │
                  ┌──────┴────────┐
                  │  SQLite       │
                  │  (notes.db)   │
                  └──────┬────────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
     Daily Email    Health Check   Categorize
     (cron, 8am)    (cron)         (manual)
```

Both services run as Docker containers via Docker Compose, sharing `notes.db` through a bind mount.

## Prerequisites

- Docker and Docker Compose
- A `.env` file (see below)
- (For semantic search) An OpenAI API key

## Quick Start

### 1. Create a `.env` file

```
OPENAI_API_KEY=sk-...
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=your_email@gmail.com
MAIL_PASSWORD=your_gmail_app_password
MAIL_DEFAULT_SENDER=your_email@gmail.com
```

### 2. Build and run

```bash
./deploy.sh
```

Or manually:

```bash
docker build -t think_tank .
docker compose up -d
```

### 3. Verify

```bash
docker compose ps
```

- Streamlit UI: `http://localhost:8502`
- Flask API: `http://localhost:6000`

## API Endpoints

### `POST /add_note`

Capture an idea.

```bash
curl -X POST http://localhost:6000/add_note \
  -H "Content-Type: application/json" \
  -d '{"content": "Try a new synth plugin"}'
```

### `POST /add_todo`

Add a task with a size.

```bash
curl -X POST http://localhost:6000/add_todo \
  -H "Content-Type: application/json" \
  -d '{"content": "Book dentist appointment", "size": "big"}'
```

Size options: `tiny`, `small`, `big`, `project`

### `GET /list_todos`

List all open tasks.

### `POST /complete_todo`

Mark a task as done. Body: `{"id": 123}`

### `POST /delete_todo`

Delete a task. Body: `{"id": 123}`

## Streamlit UI

The dashboard at `:8502` has four tabs:

| Tab | Description |
|-----|-------------|
| **Focus** | Top 5 most urgent tasks, sorted by age and size weight. Color-coded: green (0-2d), orange (3-6d), red (7+d) |
| **All Tasks** | Add new tasks, view all open todos, completed tasks with time-to-complete stats |
| **Ideas** | Chronological list of captured ideas grouped by date |
| **Search** | Semantic search over ideas using OpenAI embeddings with cosine similarity |

## Database Schema

SQLite database at `notes.db`. Tables are auto-created by `app.py` on startup.

**ideas**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key, autoincrement |
| content | TEXT | Idea text |
| timestamp | DATETIME | Vancouver time |
| embedding | TEXT | JSON array from OpenAI (populated lazily) |

**todo**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key, autoincrement |
| content | TEXT | Task text |
| size | TEXT | `tiny`, `small`, `big`, or `project` |
| timestamp | DATETIME | Vancouver time |

**completed_todo**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key, autoincrement |
| content | TEXT | Task text |
| size | TEXT | `tiny`, `small`, `big`, or `project` |
| timestamp | DATETIME | When created |
| completed_timestamp | DATETIME | When marked done |

**ideas_categorized** (created by `categorize_ideas.py`)
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | From ideas table |
| content | TEXT | Idea text |
| timestamp | DATETIME | Original timestamp |
| category_label | TEXT | Assigned category |

## Task Prioritization

Tasks in the Focus tab are ranked by:
1. Age in days (older = higher priority)
2. Size weight: project (4) > big (3) > small (2) > tiny (1)

## Semantic Search

- Uses OpenAI `text-embedding-3-small` model
- Embeddings are stored in the `ideas.embedding` column and auto-populated on first load
- Search computes cosine similarity and returns the top 5 matches

## Categorization

`categorize_ideas.py` assigns ideas to one of 7 categories using `all-mpnet-base-v2` sentence-transformer embeddings:

- Misc, Tech / Experiments, Books, Music Consumption / Making, Personal Life / Philosophical, Productivity, Gym / Health

This requires `torch` and `sentence-transformers` which are not in the Docker image. Run it locally in a venv:

```bash
source venv/bin/activate
python categorize_ideas.py
```

## Daily Email

`send_daily_email.py` sends an HTML digest with today's ideas and top 5 tasks. Set it up as a cron job:

```bash
crontab -e
# Add:
0 8 * * * docker exec think_tank-flask-1 python /app/send_daily_email.py
```

## Health Check

`healthcheck.py` checks if the Docker containers are running and sends an alert email if any are down. Add to cron if desired.

## Time Zones

All timestamps are stored in Vancouver time (`America/Vancouver`). No UTC conversion is used in this project.

## Data

`notes.db` is bind-mounted into the containers, so data persists on the host. The containers never hold their own copy.

## File Overview

| File | Purpose |
|------|---------|
| `app.py` | Flask API + database initialization |
| `stl.py` | Streamlit UI (4-tab dashboard) |
| `categorize_ideas.py` | ML-based idea categorization (runs outside Docker) |
| `send_daily_email.py` | Daily HTML email digest |
| `healthcheck.py` | Docker service health monitor |
| `start_apps.sh` | Manual startup script (Streamlit + Gunicorn) |
| `deploy.sh` | Docker build and deploy script |
| `Dockerfile` | Container image definition |
| `docker-compose.yml` | Multi-container orchestration |
| `requirements.txt` | Python dependencies |
| `notes.db` | SQLite database |
| `database.sql` | Legacy schema (unused) |
