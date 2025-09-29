import streamlit as st
import sqlite3
import pandas as pd
from datetime import datetime
import pytz


DB_PATH = "notes.db"

# --- Database Helper Functions ---

def get_ideas():
    """Fetches all ideas from the database, sorted by most recent."""
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas ORDER BY timestamp DESC", conn)
    conn.close()
    return df

def get_todos():
    """Fetches all to-do items from the database."""
    conn = sqlite3.connect(DB_PATH)
    # No need to order here, as we'll filter by priority in the app
    df = pd.read_sql_query("SELECT * FROM todo", conn)
    conn.close()
    return df


def delete_todo(todo_info):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    id, content, priority, created_timestamp = todo_info

    VANCOUVER_TZ = pytz.timezone("America/Vancouver")
    completed_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute('''
        INSERT INTO completed_todo (id, content, priority, timestamp, completed_timestamp)
        VALUES (?, ?, ?, ?, ?)
    ''', (id, content, priority, created_timestamp, completed_timestamp))

    cursor.execute("DELETE FROM todo WHERE id = ?", (id,))
    conn.commit()
    conn.close()




# --- UI Helper Function ---

def display_todos(df, title):
    """Renders a section for a given DataFrame of to-do items."""
    st.subheader(title)
    if not df.empty:
        # Sort by timestamp within the priority group
        df = df.sort_values(by="timestamp", ascending=False)
        for _, row in df.iterrows():
            with st.container():
                col1, col2 = st.columns([0.1, 0.9])
                with col1:
                    # Use the to-do content as the hidden label for accessibility
                    if st.checkbox(
                        label=row["content"],
                        key=f"todo_{row['id']}",
                        label_visibility="collapsed"
                    ):
                        delete_todo([row["id"], row['content'], row['priority'], row['timestamp']])
                        st.rerun()
                with col2:
                    st.markdown(
                        f"**{row['content']}**  \n"
                        f"<span style='color:gray; font-size:0.85em;'>"
                        f"Added {row['timestamp']}</span>",
                        unsafe_allow_html=True,
                    )
            st.markdown("---")  # Visual separator for each item
    else:
        # Friendly message if no tasks in this category
        st.write(f"_No {title.split(' ')[1].lower()} tasks. 🎉_")


# --- Main Streamlit App UI ---

st.set_page_config(page_title="Ideas & ToDos", layout="centered")

st.title("📝 My Think Tank")


# --- To-Do Section ---
st.header("✅ To-Do List")


with st.form("add_todo_form", clear_on_submit=True):
    new_todo = st.text_input("New Task", placeholder="Enter your task here...")
    priority = st.selectbox("Priority", ["High", "Medium", "Low"], index=1)
    submitted = st.form_submit_button("➕ Add To-Do")

    if submitted and new_todo.strip():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        VANCOUVER_TZ = pytz.timezone("America/Vancouver")
        created_timestamp = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute(
            "INSERT INTO todo (content, priority, timestamp) VALUES (?, ?, ?)",
            (new_todo.strip(), priority, created_timestamp),
        )
        conn.commit()
        conn.close()
        st.success(f"✅ Added task: {new_todo}")
        st.rerun()




todos_df = get_todos()

if not todos_df.empty:
    # Filter DataFrame for each priority level
    high_priority = todos_df[todos_df["priority"] == "High"]
    medium_priority = todos_df[todos_df["priority"] == "Medium"]
    low_priority = todos_df[todos_df["priority"] == "Low"]

    # Display each priority section in order
    display_todos(high_priority, "🔴 High Priority")
    display_todos(medium_priority, "🟡 Medium Priority")
    display_todos(low_priority, "🟢 Low Priority")

else:
    st.success("All tasks are complete! Great job.")

def get_completed_todos():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM completed_todo ORDER BY completed_timestamp DESC", conn)
    conn.close()
    return df
st.header("🏁 Completed Tasks")
completed_df = get_completed_todos()

if not completed_df.empty:
    completed_df["timestamp"] = pd.to_datetime(completed_df["timestamp"])
    completed_df["completed_timestamp"] = pd.to_datetime(completed_df["completed_timestamp"])
    completed_df["time_to_complete"] = completed_df["completed_timestamp"] - completed_df["timestamp"]

    for _, row in completed_df.iterrows():
        time_in_days = row["time_to_complete"].total_seconds() / (24*3600)
        with st.container():
            st.markdown(
                f"✅ **{row['content']}**  \n"
                f"<span style='color:gray; font-size:0.85em;'>"
                f"Added {row['timestamp']} • Completed {row['completed_timestamp']}  \n"
                f"⏱ Took {time_in_days:.1f} days</span>",
                unsafe_allow_html=True,
            )
            st.markdown("---")

    avg_time = completed_df["time_to_complete"].mean()
    avg_days = avg_time.total_seconds() / (24*3600)

    st.success(f"⏳ Average completion time: {avg_days:.1f} days")
else:
    st.info("No tasks completed yet.")




# --- Ideas Section ---
st.header("💡 Ideas")
ideas_df = get_ideas()

if not ideas_df.empty:
    for _, row in ideas_df.iterrows():
        with st.container():
            st.markdown(
                f"**{row['content']}**  \n"
                f"<span style='color:gray; font-size:0.85em;'>Added {row['timestamp']}</span>",
                unsafe_allow_html=True,
            )
            st.markdown("---")
else:
    st.info("No ideas captured yet. Add one!")




