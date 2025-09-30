import streamlit as st
import sqlite3
import pandas as pd
from datetime import datetime
import pytz
import categorize_ideas  # Your categorization script
from openai import OpenAI
import os
from dotenv import load_dotenv
import json
load_dotenv()  # this loads .env into os.environ


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

# -------------------- LOCAL FILES --------------------
import categorize_ideas  # your categorization script

# -------------------- SETUP --------------------
load_dotenv()  # loads .env file so OPENAI_API_KEY is available
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])



DB_PATH = "notes.db"
VANCOUVER_TZ = pytz.timezone("America/Vancouver")


  # picks up key from env
client = OpenAI()

# ---------------- DATABASE HELPERS ----------------

def get_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas ORDER BY timestamp DESC", conn)
    conn.close()
    return df

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

def delete_todo(todo_info):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    id, content, priority, created_timestamp = todo_info
    completed_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute('''
        INSERT INTO completed_todo (id, content, priority, timestamp, completed_timestamp)
        VALUES (?, ?, ?, ?, ?)
    ''', (id, content, priority, created_timestamp, completed_timestamp))

    cursor.execute("DELETE FROM todo WHERE id = ?", (id,))
    conn.commit()
    conn.close()

# ---------------- UI HELPERS ----------------

def display_todos(df, title):
    st.subheader(title)
    if df.empty:
        st.write(f"_No {title.split(' ')[1].lower()} tasks. 🎉_")
        return

    df = df.sort_values(by="timestamp", ascending=False)
    for _, row in df.iterrows():
        with st.container():
            col1, col2, col3 = st.columns([0.1, 0.75, 0.15])

            # Checkbox for completing task
            with col1:
                if st.checkbox(label=row["content"], key=f"todo_{row['id']}", label_visibility="collapsed"):
                    delete_todo([row["id"], row['content'], row['priority'], row['timestamp']])
                    st.rerun()

            # Task content + timestamp
            with col2:
                st.markdown(
                    f"**{row['content']}**  \n"
                    f"<span style='color:gray; font-size:0.85em;'>Added {row['timestamp']}</span>",
                    unsafe_allow_html=True,
                )

            # Delete button
            with col3:
                if st.button("🗑️ Delete", key=f"delete_{row['id']}"):
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM todo WHERE id = ?", (row['id'],))
                    conn.commit()
                    conn.close()
                    st.rerun()

        st.markdown("---")
def load_categorized_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas_categorized ORDER BY id DESC", conn)
    conn.close()
    return df

# ---------------- STREAMLIT APP ----------------

st.set_page_config(page_title="Ideas & ToDos", layout="centered")
st.title("📝 My Think Tank")

tabs = st.tabs(["To-Do & Ideas", "Ideas", "Search"])

# ---------------- TAB 1: To-Do & Ideas ----------------
with tabs[0]:
    st.header("✅ To-Do List")

    # --- Add To-Do Form ---
    with st.form("add_todo_form", clear_on_submit=True):
        new_todo = st.text_input("New Task", placeholder="Enter your task here...")
        priority = st.selectbox("Priority", ["High", "Medium", "Low"], index=1)
        submitted = st.form_submit_button("➕ Add To-Do")

        if submitted and new_todo.strip():
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            created_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                "INSERT INTO todo (content, priority, timestamp) VALUES (?, ?, ?)",
                (new_todo.strip(), priority, created_timestamp),
            )
            
            conn.commit()
            conn.close()

            
            st.success(f"✅ Added task/idea: {new_todo}")
            st.rerun()

    # --- Display To-Dos ---
    todos_df = get_todos()
    if not todos_df.empty:
        for prio, title in zip(
            ["High", "Medium", "Low"],
            ["🔴 High Priority", "🟡 Medium Priority", "🟢 Low Priority"]
        ):
            display_todos(todos_df[todos_df["priority"] == prio], title)
    else:
        st.success("All tasks are complete! Great job.")

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
            st.markdown(
                f"✅ **{row['content']}**  \n"
                f"<span style='color:gray; font-size:0.85em;'>"
                f"Added {row['timestamp']} • Completed {row['completed_timestamp']}  \n"
                f"⏱ Took {time_in_days:.1f} days • Priority: {row['priority']}</span>",
                unsafe_allow_html=True,
            )
            st.markdown("---")

        # Compute average per priority
        avg_times = (
            completed_df.groupby("priority")["time_to_complete"]
            .mean()
            .apply(lambda x: x.total_seconds() / (24*3600))
        )

        # Show averages nicely
        st.subheader("📊 Average Completion Time by Priority")
        for prio, days in avg_times.items():
            color = {"High": "🔴", "Medium": "🟡", "Low": "🟢"}.get(prio, "⚪")
            st.success(f"{color} {prio} Priority: {days:.1f} days")

    else:
        st.info("No tasks completed yet.")

# ---------------- TAB 2: Categorized Ideas ----------------
with tabs[1]:
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

with tabs[2]:
    st.header("🔍 Semantic Search")
    query = st.text_input("Search your notes...")

    ensure_embeddings_column()  # make sure everything has embeddings

    if query:
        results = semantic_search(query)
        for score, idea_id, content in results:
            st.write(f"**{content}** (similarity: {score:.2f})")