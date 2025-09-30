import sqlite3
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize
import torch
import streamlit as st

# ---------------- CONFIG ----------------
DB_PATH = "notes.db"
EMBEDDING_MODEL = "all-mpnet-base-v2"
BATCH_SIZE = 128

CATEGORY_EXAMPLES = {
    "Misc": ["Random thoughts", "Uncategorized ideas", "General musings"],
    "Tech / Experiments": ["Try a new microcontroller project", "Build a home automation setup", "Experiment with IoT devices"],
    "Books": ["Read a new book", "Take an online course", "Learn a new programming language"],
    "Music Consumption / Making": ["Listen to new songs", "Create a music track", "Learn music production techniques"],
    "Personal Life / Philosophical": ["Exercise routine", "Meditation practice", "Healthy meal planning"],
    "Productivity": ["Plan the day efficiently", "Organize workspace", "Track habits"],
    "Gym / Health": ["Weight Training", "Found new Cardio routine", "Track calories and macros", "Stretching exercises"]
}

CATEGORY_LABELS = list(CATEGORY_EXAMPLES.keys())

# ---------------- FUNCTIONS ----------------

def load_ideas():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT id, content, timestamp FROM ideas", conn)  # Include timestamp
    conn.close()
    return df

def get_embeddings(model, texts):
    return model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=False, convert_to_numpy=True)

def compute_category_embeddings(model):
    cat_embeddings = []
    for examples in CATEGORY_EXAMPLES.values():
        emb = model.encode(examples, batch_size=BATCH_SIZE, convert_to_numpy=True)
        mean_emb = np.mean(emb, axis=0)
        cat_embeddings.append(mean_emb)
    return np.vstack(cat_embeddings)

def assign_to_categories(idea_embeddings, category_embeddings):
    # Normalize to improve cosine similarity
    idea_embeddings = normalize(idea_embeddings)
    category_embeddings = normalize(category_embeddings)
    sims = cosine_similarity(idea_embeddings, category_embeddings)
    closest = np.argmax(sims, axis=1)
    return closest

def save_categorized(df):
    conn = sqlite3.connect(DB_PATH)
    df.to_sql("ideas_categorized", conn, if_exists="replace", index=False)
    conn.close()

# ---------------- MAIN ----------------
# Cache model so it isn't reloaded every time
@st.cache_resource
def load_model():
    model = SentenceTransformer(EMBEDDING_MODEL)
    model.to(torch.device("cpu"))
    return model

def categorize_ideas():
    model = load_model()
    df = load_ideas()  # Make sure load_ideas() also fetches timestamp
    if df.empty:
        return pd.DataFrame(columns=["id", "content", "timestamp", "category_label"])

    idea_embeddings = get_embeddings(model, df['content'].tolist())
    category_embeddings = compute_category_embeddings(model)
    assigned_idx = assign_to_categories(idea_embeddings, category_embeddings)
    df['category_label'] = [CATEGORY_LABELS[i] for i in assigned_idx]

    # Only keep the columns needed for Streamlit UI
    df_categorized = df[['id', 'content', 'timestamp', 'category_label']]

    save_categorized(df_categorized)
    return df_categorized