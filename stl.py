import streamlit as st
import sqlite3
import pandas as pd
from datetime import datetime
import pytz
import categorize_ideas  # Your categorization script

DB_PATH = "notes.db"
VANCOUVER_TZ = pytz.timezone("America/Vancouver")

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
            col1, col2 = st.columns([0.1, 0.9])
            with col1:
                if st.checkbox(label=row["content"], key=f"todo_{row['id']}", label_visibility="collapsed"):
                    delete_todo([row["id"], row['content'], row['priority'], row['timestamp']])
                    st.rerun()
            with col2:
                st.markdown(
                    f"**{row['content']}**  \n"
                    f"<span style='color:gray; font-size:0.85em;'>Added {row['timestamp']}</span>",
                    unsafe_allow_html=True,
                )
        st.markdown("---")

def load_categorized_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM ideas_categorized ORDER BY id DESC", conn)
    conn.close()
    return df

# ---------------- STREAMLIT APP ----------------

st.set_page_config(page_title="Ideas & ToDos", layout="centered")
st.title("📝 My Think Tank")

tabs = st.tabs(["To-Do & Ideas", "Categorized Ideas"])

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
            # Also insert as an idea for categorization
            cursor.execute(
                "INSERT INTO ideas (content, timestamp) VALUES (?, ?)",
                (new_todo.strip(), created_timestamp),
            )
            conn.commit()
            conn.close()

            # Automatically categorize all ideas
            # categorize_ideas.categorize_ideas()

            st.success(f"✅ Added task/idea: {new_todo}")
            st.rerun()

    # --- Display To-Dos ---
    todos_df = get_todos()
    if not todos_df.empty:
        for prio, title in zip(["High", "Medium", "Low"], ["🔴 High Priority", "🟡 Medium Priority", "🟢 Low Priority"]):
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

        for _, row in completed_df.iterrows():
            time_in_days = row["time_to_complete"].total_seconds() / (24*3600)
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
    # st.header("💡 Ideas")
    # ideas_df = get_ideas()
    # if not ideas_df.empty:
    #     for _, row in ideas_df.iterrows():
    #         st.write(row['content'])
    #         st.markdown(
    #             f"<span style='color:gray; font-size:0.85em;'>Added {row['timestamp']}</span>",
    #             unsafe_allow_html=True,
    #         )
    #         st.markdown("---")
    # else:
    #     st.info("No ideas captured yet. Add one!")
    # --- Ideas Section (Grouped by Day) ---
# --- Ideas Section (Grouped by Day, Keep Time) ---
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
# # ---------------- TAB 2: Categorized Ideas ----------------
# with tabs[1]:
#     st.header("📊 Categorized Ideas")
#     df = load_categorized_ideas()
    
#     if not df.empty:
#         for cat in df['category_label'].unique():
#             st.markdown(f"<h2 style='color:#1f77b4'>{cat}</h2>", unsafe_allow_html=True)
#             cat_df = df[df['category_label'] == cat]
#             for _, row in cat_df.iterrows():
#                 st.markdown(f"""
#                 <div style="
#                     border: 1px solid #ccc; 
#                     border-radius: 8px; 
#                     padding: 10px; 
#                     margin-bottom: 10px; 
#                     background-color:#333333; color:white;
#                 ">
#                     <p style='margin:0'>{row['content']}</p>
#                     <span style='color:gray; font-size:0.85em;'>Added {row['timestamp']}</span>
#                 </div>
#                 """, unsafe_allow_html=True)
#     else:
#         st.info("No categorized ideas found. Add ideas first!")