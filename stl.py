# -------------------- BUILT-IN LIBRARIES --------------------
import os
import sqlite3
import json
from datetime import datetime
import pytz

# -------------------- THIRD-PARTY LIBRARIES --------------------
import streamlit as st
import pandas as pd
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv
from openai import OpenAI

# categorize_ideas is intentionally not imported here — it requires
# heavy ML dependencies (torch, sentence-transformers) and is run manually.

# -------------------- SETUP --------------------
load_dotenv()  # loads .env file so OPENAI_API_KEY is available
client = OpenAI()

DB_PATH = "notes.db"
VANCOUVER_TZ = pytz.timezone("America/Vancouver")

# ---------------- DATABASE HELPERS ----------------

def migrate_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    for table in ("todo", "completed_todo"):
        cursor.execute(f"PRAGMA table_info({table})")
        cols = [col[1] for col in cursor.fetchall()]
        if cols and "size" not in cols:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN size TEXT DEFAULT 'small'")
        if table == "completed_todo" and cols and "completed_timestamp" not in cols:
            cursor.execute("ALTER TABLE completed_todo ADD COLUMN completed_timestamp DATETIME")
    conn.commit()
    conn.close()

migrate_db()

def get_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas ORDER BY timestamp DESC", conn)
    conn.close()
    return df

SIZE_ORDER = {'project': 4, 'big': 3, 'small': 2, 'tiny': 1}

SIZE_PILL = {
    'tiny':    ("<span style='background:#6c757d; color:white; padding:2px 8px; "
                "border-radius:12px; font-size:0.72em; font-weight:600; letter-spacing:0.03em;'>TINY</span>"),
    'small':   ("<span style='background:#0d6efd; color:white; padding:2px 8px; "
                "border-radius:12px; font-size:0.72em; font-weight:600; letter-spacing:0.03em;'>SMALL</span>"),
    'big':     ("<span style='background:#e67e22; color:white; padding:2px 8px; "
                "border-radius:12px; font-size:0.72em; font-weight:600; letter-spacing:0.03em;'>BIG</span>"),
    'project': ("<span style='background:#6f42c1; color:white; padding:2px 8px; "
                "border-radius:12px; font-size:0.72em; font-weight:600; letter-spacing:0.03em;'>PROJECT</span>"),
}

STALENESS_BORDER = {
    'fresh':  '#2ecc71',  # green  — 0-2 days
    'aging':  '#e67e22',  # orange — 3-6 days
    'stale':  '#c0392b',  # red    — 7+ days
}

def staleness_key(days_old):
    if days_old >= 7:
        return 'stale'
    elif days_old >= 3:
        return 'aging'
    return 'fresh'

SIZE_LABEL = {'tiny': 'Tiny', 'small': 'Small', 'big': 'Big', 'project': 'Project'}

def get_todos():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM todo", conn)
    conn.close()
    return df

def get_completed_todos():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM completed_todo ORDER BY completed_timestamp DESC", conn)
    conn.close()
    return df

def complete_todo(todo_info):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    id, content, size, created_timestamp = todo_info
    if hasattr(created_timestamp, 'strftime'):
        created_timestamp = created_timestamp.strftime("%Y-%m-%d %H:%M:%S")
    completed_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute('''
        INSERT INTO completed_todo (id, content, size, timestamp, completed_timestamp)
        VALUES (?, ?, ?, ?, ?)
    ''', (id, content, size, created_timestamp, completed_timestamp))
    cursor.execute("DELETE FROM todo WHERE id = ?", (id,))
    conn.commit()
    conn.close()


def get_focus_todos(df, n=5):
    if df.empty:
        return df
    now = datetime.now(VANCOUVER_TZ)
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["days_old"] = df["timestamp"].apply(
        lambda t: (now - VANCOUVER_TZ.localize(t)).days if t.tzinfo is None else (now - t).days
    )
    df["size_weight"] = df["size"].map(SIZE_ORDER).fillna(2)
    df = df.sort_values(by=["days_old", "size_weight"], ascending=False)
    return df.head(n)

# ---------------- UI HELPERS ----------------

def display_todos(df, key_prefix=""):
    if df.empty:
        st.success("All clear!")
        return

    now = datetime.now(VANCOUVER_TZ)
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["days_old"] = df["timestamp"].apply(
        lambda t: (now - VANCOUVER_TZ.localize(t)).days if t.tzinfo is None else (now - t).days
    )
    df["size_weight"] = df["size"].map(SIZE_ORDER).fillna(2)
    df = df.sort_values(by=["days_old", "size_weight"], ascending=False)

    for _, row in df.iterrows():
        days_old = int(row["days_old"])
        size = row.get("size") or "small"
        age_label = f"{days_old}d old" if days_old > 0 else "today"
        border_color = STALENESS_BORDER[staleness_key(days_old)]
        pill = SIZE_PILL.get(size, SIZE_PILL['small'])

        st.markdown(
            f"<div style='border-left: 4px solid {border_color}; padding-left: 12px; margin-bottom: 4px;'>"
            f"<strong>{row['content']}</strong><br>"
            f"<span style='font-size:0.8em; color:gray;'>{age_label}</span>&nbsp;&nbsp;{pill}"
            f"</div>",
            unsafe_allow_html=True,
        )

        col1, col2 = st.columns([0.85, 0.15])
        with col1:
            if st.checkbox("Mark complete", key=f"{key_prefix}todo_{row['id']}", label_visibility="collapsed"):
                complete_todo([row["id"], row["content"], size, row["timestamp"]])
                st.rerun()
        with col2:
            if st.button("🗑️", key=f"{key_prefix}delete_{row['id']}"):
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("DELETE FROM todo WHERE id = ?", (row["id"],))
                conn.commit()
                conn.close()
                st.rerun()

        st.markdown("<div style='margin-bottom:12px;'></div>", unsafe_allow_html=True)
def load_categorized_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas_categorized ORDER BY id DESC", conn)
    conn.close()
    return df

# ---------------- STREAMLIT APP ----------------

st.set_page_config(page_title="Think Tank", layout="centered")
st.title("Think Tank")

tabs = st.tabs(["Focus", "All Tasks", "Ideas", "Search"])

# ---------------- TAB 1: Focus ----------------
with tabs[0]:
    st.header("🎯 Focus — Your Top 5")

    todos_df = get_todos()
    focus_df = get_focus_todos(todos_df, n=5)

    if focus_df.empty:
        st.success("Nothing to do. You're clear!")
    else:
        remaining = max(0, len(todos_df) - len(focus_df))
        if remaining > 0:
            st.caption(f"{remaining} more tasks in the backlog — just focus on these.")
        display_todos(focus_df, key_prefix="focus_")

# ---------------- TAB 2: All Tasks ----------------
with tabs[1]:
    st.header("📋 All Tasks")

    # --- Add To-Do Form ---
    with st.form("add_todo_form", clear_on_submit=True):
        new_todo = st.text_input("New Task", placeholder="Enter your task here...")
        size = st.selectbox("Size", ["tiny", "small", "big", "project"], index=1)
        submitted = st.form_submit_button("➕ Add To-Do")

        if submitted and new_todo.strip():
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            created_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                "INSERT INTO todo (content, size, timestamp) VALUES (?, ?, ?)",
                (new_todo.strip(), size, created_timestamp),
            )
            conn.commit()
            conn.close()
            st.success(f"✅ Added: {new_todo}")
            st.rerun()

    todos_df = get_todos()
    display_todos(todos_df, key_prefix="all_")

    # --- Completed Tasks ---
    st.header("🏁 Completed Tasks")
    completed_df = get_completed_todos()
    if not completed_df.empty:
        completed_df["timestamp"] = pd.to_datetime(completed_df["timestamp"])
        completed_df["completed_timestamp"] = pd.to_datetime(completed_df["completed_timestamp"])
        completed_df["time_to_complete"] = completed_df["completed_timestamp"] - completed_df["timestamp"]

        # Display each completed task
        for _, row in completed_df.iterrows():
            time_in_days = row["time_to_complete"].total_seconds() / (24*3600)
            size = row.get("size") or "small"
            st.markdown(
                f"✅ **{row['content']}**  \n"
                f"<span style='color:gray; font-size:0.85em;'>"
                f"Added {row['timestamp']} · Completed {row['completed_timestamp']}  \n"
                f"⏱ Took {time_in_days:.1f} days · {SIZE_LABEL.get(size, size)}</span>",
                unsafe_allow_html=True,
            )
            st.markdown("---")

        # Average completion time by size
        avg_times = (
            completed_df.groupby("size")["time_to_complete"]
            .mean()
            .apply(lambda x: x.total_seconds() / (24*3600))
        )

        st.subheader("📊 Average Completion Time by Size")
        for size, days in avg_times.items():
            label = SIZE_LABEL.get(size, size)
            st.success(f"{label}: {days:.1f} days")

    else:
        st.info("No tasks completed yet.")

# ---------------- TAB 3: Ideas ----------------
with tabs[2]:
    st.header("💡 Ideas")
    


    ideas_df = get_ideas()
    if not ideas_df.empty:
        # Ensure timestamp is datetime
        ideas_df["timestamp"] = pd.to_datetime(ideas_df["timestamp"])
        # Extract just the date for grouping
        ideas_df["date"] = ideas_df["timestamp"].dt.date

        # Group by date (newest first)
        for date, group in ideas_df.groupby("date", sort=False):
            st.subheader(f"{date.strftime('%A, %B %d, %Y')}")  # e.g., Monday, September 28, 2025
            for _, row in group.iterrows():
                time_str = row["timestamp"].strftime("%H:%M:%S")
                st.markdown(f"- {row['content']}  <span style='color:gray; font-size:0.85em;'>at {time_str}</span>", unsafe_allow_html=True)
            st.markdown("---")
    else:
        st.info("No ideas captured yet. Add one!")



def ensure_embeddings_column():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if column exists
    cursor.execute("PRAGMA table_info(ideas)")
    columns = [col[1] for col in cursor.fetchall()]
    if "embedding" not in columns:
        cursor.execute("ALTER TABLE ideas ADD COLUMN embedding TEXT")
        conn.commit()

    # Find rows missing embeddings
    cursor.execute("SELECT id, content FROM ideas WHERE embedding IS NULL")
    rows = cursor.fetchall()

    for idea_id, content in rows:
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=content
        )
        emb = response.data[0].embedding
        cursor.execute(
            "UPDATE ideas SET embedding=? WHERE id=?",
            (json.dumps(emb), idea_id)
        )

    conn.commit()
    conn.close()


def semantic_search(query, top_k=5):
    # Embed query
    q_emb = client.embeddings.create(
        model="text-embedding-3-small",
        input=query
    ).data[0].embedding
    q_vec = np.array(q_emb).reshape(1, -1)

    # Load rows
    conn = sqlite3.connect(DB_PATH, timeout=10)
    cursor = conn.cursor()
    cursor.execute("SELECT id, content, embedding FROM ideas WHERE embedding IS NOT NULL")
    rows = cursor.fetchall()
    conn.close()

    similarities = []
    for idea_id, content, emb_str in rows:
        emb = np.array(json.loads(emb_str)).reshape(1, -1)
        score = cosine_similarity(q_vec, emb)[0][0]
        similarities.append((score, idea_id, content))

    similarities.sort(reverse=True, key=lambda x: x[0])
    return similarities[:top_k]

with tabs[3]:
    st.header("🔍 Semantic Search")
    query = st.text_input("Search your notes...")

    ensure_embeddings_column()  # make sure everything has embeddings

    if query:
        results = semantic_search(query)
        for score, idea_id, content in results:
            st.write(f"**{content}** (similarity: {score:.2f})")