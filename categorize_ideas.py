import sqlite3
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import torch

# ---------------- CONFIG ----------------
DB_PATH = "notes.db"
EMBEDDING_MODEL = "all-mpnet-base-v2"
BATCH_SIZE = 128

# Predefined categories with example ideas
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
    """Load ideas from the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT id, content FROM ideas", conn)
    conn.close()
    return df

def get_embeddings(model, texts):
    """Compute embeddings efficiently on CPU using a shared model instance."""
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True
    )
    return embeddings

def compute_category_embeddings(model):
    """Compute mean embedding for each category from example ideas."""
    cat_embeddings = []
    for examples in CATEGORY_EXAMPLES.values():
        emb = model.encode(examples, batch_size=BATCH_SIZE, convert_to_numpy=True)
        mean_emb = np.mean(emb, axis=0)
        cat_embeddings.append(mean_emb)
    return np.vstack(cat_embeddings)

def assign_to_categories(idea_embeddings, category_embeddings):
    """Assign each idea to the closest predefined category."""
    sims = cosine_similarity(idea_embeddings, category_embeddings)
    closest = np.argmax(sims, axis=1)
    return closest

def save_categorized(df):
    """Save categorized ideas to SQLite."""
    conn = sqlite3.connect(DB_PATH)
    df.to_sql("ideas_categorized", conn, if_exists="replace", index=False)
    conn.close()




# ---------------- MAIN ----------------

def main():
    # Force CPU device
    device = torch.device("cpu")
    model = SentenceTransformer(EMBEDDING_MODEL)
    model.to(device)

    df = load_ideas()
    if df.empty:
        print("No ideas found in the database.")
        return

    print(f"Loaded {len(df)} ideas.")

    print("Computing embeddings for ideas...")
    idea_embeddings = get_embeddings(model, df['content'].tolist())

    print("Computing embeddings for predefined categories...")
    category_embeddings = compute_category_embeddings(model)

    print("Assigning each idea to the closest category...")
    assigned_idx = assign_to_categories(idea_embeddings, category_embeddings)
    df['category_label'] = [CATEGORY_LABELS[i] for i in assigned_idx]

    print("Saving categorized ideas to DB...")
    save_categorized(df)



if __name__ == "__main__":
    main()