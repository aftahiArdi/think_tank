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
