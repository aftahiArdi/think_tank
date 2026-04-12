# Shared Feed & User Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared social feed where users opt-in share idea cards, user profile pictures in settings, and reorganise the bottom nav/settings layout.

**Architecture:** Lightweight `shared_feed` join table keeps ideas private by default. Avatars stored at `uploads/avatars/<username>.<ext>`. New Feed tab added to bottom nav. Settings dialog gets profile (top) + theme (bottom). Backend extends existing ideas responses with `owner_username` and `is_shared` fields. No separate auth changes needed.

**Tech Stack:** Flask + SQLite, Next.js App Router, SWR, TypeScript, lucide-react, existing shadcn/ui components, existing upload patterns.

---

## File Map

**Created:**
- `frontend/components/feed/avatar-circle.tsx` — reusable circular avatar (photo or coloured initials)
- `frontend/components/feed/feed-post-card.tsx` — single shared post card
- `frontend/components/feed/feed-view.tsx` — full Feed tab with SWR + pull-to-refresh
- `frontend/components/feed/share-confirm-sheet.tsx` — "Is this worth sharing?" bottom sheet
- `frontend/lib/hooks/use-feed.ts` — SWR hook for shared feed

**Modified:**
- `app.py` — DB migrations, extend ideas responses, 5 new endpoints
- `frontend/lib/types.ts` — extend `Idea`, add `FeedPost`
- `frontend/lib/api.ts` — 5 new API functions
- `frontend/components/layout/bottom-nav.tsx` — add Feed tab
- `frontend/components/home-client.tsx` — feed tab + settings dialog reorg
- `frontend/app/ideas/[id]/page.tsx` — share/unshare button

---

### Task 1: DB Migrations in Flask

**Files:**
- Modify: `app.py` (init_db function, lines ~21-120)

- [ ] **Step 1: Add shared_feed table and avatar_filename migration to init_db()**

Open `app.py`. Find the `init_db()` function. After the `users` table `CREATE TABLE IF NOT EXISTS` block (around line 78), add:

```python
    # shared_feed table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shared_feed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            shared_at DATETIME NOT NULL,
            UNIQUE(idea_id)
        )
    ''')

    # Migrate users table: add avatar_filename if missing
    cursor.execute("PRAGMA table_info(users)")
    user_cols = [r[1] for r in cursor.fetchall()]
    if "avatar_filename" not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar_filename TEXT")
```

- [ ] **Step 2: Create uploads/avatars directory**

```bash
mkdir -p /home/ardi/Projects/think_tank/uploads/avatars
```

- [ ] **Step 3: Rebuild Flask container and verify migrations run**

```bash
cd /home/ardi/Projects/think_tank
docker compose build --no-cache flask && docker compose up -d --force-recreate flask
docker logs think_tank_api --tail=20
```

Expected: no errors, gunicorn starts cleanly.

- [ ] **Step 4: Verify tables exist**

```bash
docker exec -it think_tank_api python3 -c "
import sqlite3
conn = sqlite3.connect('notes.db')
c = conn.cursor()
c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")
print([r[0] for r in c.fetchall()])
c.execute('PRAGMA table_info(users)')
print([r[1] for r in c.fetchall()])
"
```

Expected output includes `shared_feed` in table list and `avatar_filename` in users columns.

- [ ] **Step 5: Commit**

```bash
git add app.py
git commit -m "feat: add shared_feed table and avatar_filename column"
```

---

### Task 2: Extend Ideas API Responses

**Files:**
- Modify: `app.py` — `list_ideas()` (~line 314) and `get_idea()` (~line 399)

Add `owner_username` and `is_shared` to both responses. `owner_username` lets the frontend know if an idea belongs to the current user (compare to `think_tank_user` cookie). `is_shared` lets the detail page show the correct button state.

- [ ] **Step 1: Update list_ideas() query and response**

Find `list_ideas()`. Replace the SELECT query:

```python
        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.user_id = ?
            ORDER BY i.timestamp DESC
        ''', (user_id,))
```

Then in the idea dict construction, add the two new fields:

```python
            idea = {
                'id': row['id'],
                'content': row['content'],
                'timestamp': row['timestamp'],
                'media_type': row['media_type'] or 'text',
                'has_media': bool(row['has_media']),
                'starred': bool(row['starred']),
                'owner_username': row['owner_username'],
                'is_shared': bool(row['is_shared']),
                'category': None,
                'media': media_by_idea.get(row['id'], [])
            }
```

- [ ] **Step 2: Update get_idea() query and response**

Find `get_idea()`. Replace the SELECT query:

```python
        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color,
                   u.username as owner_username,
                   CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_shared
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN shared_feed sf ON sf.idea_id = i.id
            WHERE i.id = ? AND i.user_id = ?
        ''', (idea_id, user_id))
```

Replace the return jsonify call:

```python
        return jsonify({
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),
            'owner_username': row['owner_username'],
            'is_shared': bool(row['is_shared']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
```

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: add owner_username and is_shared to ideas API responses"
```

---

### Task 3: Flask Feed Endpoints

**Files:**
- Modify: `app.py` — add after the `/uploads/<path:filename>` route (~line 656)

- [ ] **Step 1: Add GET /feed endpoint**

Add after the `serve_upload` route:

```python
@app.route('/feed', methods=['GET'])
def get_feed():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT sf.id, sf.idea_id, sf.user_id, sf.shared_at,
                   i.content,
                   u.username as author_username,
                   u.avatar_filename
            FROM shared_feed sf
            JOIN ideas i ON i.id = sf.idea_id
            JOIN users u ON u.id = sf.user_id
            ORDER BY sf.shared_at DESC
        ''')
        rows = cursor.fetchall()

        idea_ids = [r['idea_id'] for r in rows]
        media_by_idea = {}
        if idea_ids:
            placeholders = ','.join('?' * len(idea_ids))
            cursor.execute(
                f'SELECT id, idea_id, filename, media_type, file_size FROM idea_media WHERE idea_id IN ({placeholders})',
                idea_ids
            )
            for m in cursor.fetchall():
                media_by_idea.setdefault(m['idea_id'], []).append({
                    'id': m['id'],
                    'media_type': m['media_type'],
                    'file_size': m['file_size'],
                    'url': f"/api/flask/uploads/{m['filename']}"
                })

        posts = []
        for row in rows:
            avatar_url = None
            if row['avatar_filename']:
                avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"
            posts.append({
                'id': row['id'],
                'idea_id': row['idea_id'],
                'shared_at': row['shared_at'],
                'author': {
                    'username': row['author_username'],
                    'avatar_url': avatar_url,
                },
                'content': row['content'],
                'media': media_by_idea.get(row['idea_id'], []),
                'is_mine': row['user_id'] == user_id,
            })

        conn.close()
        return jsonify({'posts': posts}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/share/<int:idea_id>', methods=['POST'])
def share_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        # Verify ownership
        cursor.execute('SELECT id FROM ideas WHERE id = ? AND user_id = ?', (idea_id, user_id))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Idea not found or not yours'}), 403

        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        try:
            cursor.execute(
                'INSERT INTO shared_feed (idea_id, user_id, shared_at) VALUES (?, ?, ?)',
                (idea_id, user_id, vancouver_time)
            )
            shared_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Already shared'}), 409

        conn.commit()
        conn.close()
        return jsonify({'id': shared_id}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/feed/share/<int:idea_id>', methods=['DELETE'])
def unshare_idea(idea_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()

        cursor.execute(
            'DELETE FROM shared_feed WHERE idea_id = ? AND user_id = ?',
            (idea_id, user_id)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Unshared'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Commit**

```bash
git add app.py
git commit -m "feat: add GET/POST/DELETE feed endpoints"
```

---

### Task 4: Flask Avatar Upload Endpoint

**Files:**
- Modify: `app.py` — add after feed routes

- [ ] **Step 1: Add POST /profile/avatar and GET /profile**

```python
@app.route('/profile', methods=['GET'])
def get_profile():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    username = request.headers.get('X-Think-Tank-User', '').strip().lower()
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT username, avatar_filename FROM users WHERE id = ?', (user_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({'error': 'User not found'}), 404
        avatar_url = None
        if row['avatar_filename']:
            avatar_url = f"/api/flask/uploads/avatars/{row['avatar_filename']}"
        return jsonify({'username': row['username'], 'avatar_url': avatar_url}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/profile/avatar', methods=['POST'])
def upload_avatar():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401

    username = request.headers.get('X-Think-Tank-User', 'unknown').strip().lower()

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    content_type = file.content_type or ''
    if not content_type.startswith('image/'):
        return jsonify({'error': 'Only images allowed'}), 400

    # Determine extension from MIME type
    ext_map = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic'}
    ext = ext_map.get(content_type, 'jpg')
    filename = f"{username}.{ext}"
    filepath = os.path.join('uploads', 'avatars', filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    try:
        file.save(filepath)
        conn = sqlite3.connect('notes.db')
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET avatar_filename = ? WHERE id = ?', (filename, user_id))
        conn.commit()
        conn.close()
        import time
        avatar_url = f"/api/flask/uploads/avatars/{filename}?v={int(time.time())}"
        return jsonify({'avatar_url': avatar_url}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Rebuild Flask and verify all new endpoints respond**

```bash
docker compose build --no-cache flask && docker compose up -d --force-recreate flask
# Test feed endpoint (replace cookie value with your actual think_tank_auth cookie)
curl -s -b "think_tank_auth=<your_cookie>" http://localhost:6000/feed | python3 -m json.tool
```

Expected: `{"posts": []}` (empty, nothing shared yet)

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: add profile and avatar upload endpoints"
```

---

### Task 5: Frontend Types

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Extend Idea type and add FeedPost**

Replace the entire contents of `frontend/lib/types.ts`:

```typescript
export interface IdeaMedia {
  id: number;
  filename: string;
  media_type: "image" | "sketch" | "video" | "audio";
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
  media_type: "text" | "image" | "sketch" | "video" | "audio" | "mixed";
  has_media: boolean;
  starred: boolean;
  owner_username: string;
  is_shared: boolean;
  category: Category | null;
  media: IdeaMedia[];
}

export interface FeedPost {
  id: number;
  idea_id: number;
  shared_at: string;
  author: {
    username: string;
    avatar_url: string | null;
  };
  content: string;
  media: IdeaMedia[];
  is_mine: boolean;
}

export interface SearchResult {
  id: number;
  content: string;
  timestamp: string;
  similarity: number;
  category: Category | null;
}

export type ThemeName =
  | "minimal-dark"
  | "soft-neutral"
  | "glass-modern"
  | "midnight"
  | "moonlight"
  | "warm-charcoal"
  | "nord"
  | "forest";
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat: extend Idea type, add FeedPost type"
```

---

### Task 6: Frontend API Functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add 5 new API functions at the end of api.ts**

```typescript
export async function fetchFeed() {
  const res = await fetch(`${API_BASE}/feed`);
  return handleResponse<{ posts: import("./types").FeedPost[] }>(res);
}

export async function shareIdea(ideaId: number) {
  const res = await fetch(`${API_BASE}/feed/share/${ideaId}`, { method: "POST" });
  return handleResponse<{ id: number }>(res);
}

export async function unshareIdea(ideaId: number) {
  const res = await fetch(`${API_BASE}/feed/share/${ideaId}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}

export async function fetchProfile() {
  const res = await fetch(`${API_BASE}/profile`);
  return handleResponse<{ username: string; avatar_url: string | null }>(res);
}

export async function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetch(`${API_BASE}/profile/avatar`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<{ avatar_url: string }>(res);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add feed, share, and avatar API functions"
```

---

### Task 7: AvatarCircle Component

**Files:**
- Create: `frontend/components/feed/avatar-circle.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

function usernameColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = Math.imul(31, hash) + username.charCodeAt(i) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

interface AvatarCircleProps {
  username: string;
  avatarUrl?: string | null;
  size?: number;
}

export function AvatarCircle({ username, avatarUrl, size = 40 }: AvatarCircleProps) {
  const initials = username.slice(0, 2).toUpperCase();
  const bg = usernameColor(username);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.35,
        fontWeight: 700,
        color: "#fff",
        letterSpacing: "-0.02em",
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={username}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/feed/avatar-circle.tsx
git commit -m "feat: add AvatarCircle component"
```

---

### Task 8: useFeed Hook

**Files:**
- Create: `frontend/lib/hooks/use-feed.ts`

- [ ] **Step 1: Create the hook**

```typescript
import useSWR from "swr";
import { fetchFeed, unshareIdea } from "@/lib/api";
import type { FeedPost } from "@/lib/types";
import { toast } from "sonner";

export function useFeed() {
  const { data, isLoading, mutate } = useSWR("feed", fetchFeed, {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
  });

  const posts: FeedPost[] = data?.posts ?? [];

  const removePost = async (ideaId: number) => {
    const optimistic = posts.filter((p) => p.idea_id !== ideaId);
    mutate(
      async () => {
        await unshareIdea(ideaId);
        return fetchFeed();
      },
      {
        optimisticData: { posts: optimistic },
        rollbackOnError: true,
      }
    ).catch(() => toast.error("Failed to unshare"));
  };

  return { posts, isLoading, mutate, removePost };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/hooks/use-feed.ts
git commit -m "feat: add useFeed SWR hook"
```

---

### Task 9: FeedPostCard Component

**Files:**
- Create: `frontend/components/feed/feed-post-card.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AvatarCircle } from "./avatar-circle";
import type { FeedPost } from "@/lib/types";

function timeAgo(ts: string): string {
  const now = Date.now();
  const then = new Date(ts.replace(" ", "T")).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface FeedPostCardProps {
  post: FeedPost;
  onUnshare?: () => void;
}

export function FeedPostCard({ post, onUnshare }: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const images = post.media.filter((m) => m.media_type === "image" || m.media_type === "sketch");
  const videos = post.media.filter((m) => m.media_type === "video");
  const audios = post.media.filter((m) => m.media_type === "audio");

  return (
    <>
      <div
        className="rounded-2xl px-4 py-3 space-y-2.5"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Author row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AvatarCircle
              username={post.author.username}
              avatarUrl={post.author.avatar_url}
              size={36}
            />
            <div>
              <p className="text-sm font-semibold leading-tight" style={{ color: "var(--foreground)" }}>
                {post.author.username}
              </p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                {timeAgo(post.shared_at)}
              </p>
            </div>
          </div>
          {post.is_mine && onUnshare && (
            <button
              onClick={onUnshare}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]"
              style={{ color: "var(--muted-foreground)", backgroundColor: "var(--muted)" }}
            >
              <X size={11} />
              Remove
            </button>
          )}
        </div>

        {/* Content */}
        {post.content && (
          <p
            className="text-sm leading-relaxed"
            style={{
              color: "var(--foreground)",
              display: "-webkit-box",
              WebkitLineClamp: expanded ? undefined : 4,
              WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
              overflow: expanded ? "visible" : "hidden",
            }}
            onClick={() => setExpanded((e) => !e)}
          >
            {post.content}
          </p>
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {images.map((m) => (
              <button
                key={m.id}
                onClick={() => setLightbox(m.url)}
                className="flex-shrink-0"
              >
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  className="w-20 h-20 rounded-xl object-cover"
                  style={{ backgroundColor: m.media_type === "sketch" ? "#111" : "var(--muted)" }}
                />
              </button>
            ))}
          </div>
        )}

        {/* Video / audio chips */}
        {(videos.length > 0 || audios.length > 0) && (
          <div className="flex gap-2 flex-wrap">
            {videos.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
              >
                🎥 Video
              </div>
            ))}
            {audios.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
              >
                🎙️ Voice memo
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain p-4" />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/feed/feed-post-card.tsx
git commit -m "feat: add FeedPostCard component"
```

---

### Task 10: ShareConfirmSheet Component

**Files:**
- Create: `frontend/components/feed/share-confirm-sheet.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { X } from "lucide-react";

interface ShareConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  content: string;
}

export function ShareConfirmSheet({ open, onClose, onConfirm, content }: ShareConfirmSheetProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />
      <div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl"
        style={{
          backgroundColor: "var(--background)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(24px, env(safe-area-inset-bottom))",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--border)" }} />
        </div>

        <div className="px-5 pb-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Share to feed?
            </h3>
            <button onClick={onClose}>
              <X size={18} style={{ color: "var(--muted-foreground)" }} />
            </button>
          </div>

          {/* Prompt */}
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Is this thought worth sharing with everyone?
          </p>

          {/* Preview */}
          {content && (
            <div
              className="rounded-xl px-4 py-3 text-sm leading-relaxed"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                overflow: "hidden",
              }}
            >
              {content}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium"
              style={{
                backgroundColor: "var(--muted)",
                color: "var(--muted-foreground)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{
                backgroundColor: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              Share
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/feed/share-confirm-sheet.tsx
git commit -m "feat: add ShareConfirmSheet component"
```

---

### Task 11: FeedView Component

**Files:**
- Create: `frontend/components/feed/feed-view.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useFeed } from "@/lib/hooks/use-feed";
import { FeedPostCard } from "./feed-post-card";

export function FeedView() {
  const { posts, isLoading, mutate, removePost } = useFeed();

  const handleRefresh = async () => {
    await mutate();
  };

  if (isLoading) {
    return (
      <div className="pt-16 flex justify-center" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="pt-16 text-center px-8" style={{ color: "var(--muted-foreground)" }}>
        <p className="text-2xl mb-3">💬</p>
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Nothing shared yet</p>
        <p className="text-xs mt-1">Share an idea from your feed to post it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {posts.map((post) => (
        <FeedPostCard
          key={post.id}
          post={post}
          onUnshare={post.is_mine ? () => removePost(post.idea_id) : undefined}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/feed/feed-view.tsx
git commit -m "feat: add FeedView component"
```

---

### Task 12: Bottom Nav — Add Feed Tab

**Files:**
- Modify: `frontend/components/layout/bottom-nav.tsx`

- [ ] **Step 1: Add Feed tab to bottom-nav.tsx**

Replace the entire file:

```typescript
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Search, Bookmark, FolderOpen, Plus, Users } from "lucide-react";

export type TabName = "ideas" | "search" | "feed" | "starred" | "categories";

const tabs: { name: TabName; icon: typeof Lightbulb; label: string }[] = [
  { name: "ideas",      icon: Lightbulb,  label: "Ideas"   },
  { name: "search",     icon: Search,     label: "Search"  },
  { name: "feed",       icon: Users,      label: "Feed"    },
  { name: "starred",    icon: Bookmark,   label: "Starred" },
  { name: "categories", icon: FolderOpen, label: "Stats"   },
];

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  onAdd: () => void;
}

export function BottomNav({ activeTab, onTabChange, onAdd }: BottomNavProps) {
  const activeIndex = tabs.findIndex((t) => t.name === activeTab);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; animate: boolean }>({
    x: 0, w: 0, animate: false,
  });

  useLayoutEffect(() => {
    const btn = btnRefs.current[activeIndex];
    const container = containerRef.current;
    if (!btn || !container) return;
    const b = btn.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setPill((prev) => ({
      x: b.left - c.left,
      w: b.width,
      animate: prev.w > 0,
    }));
  }, [activeIndex]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center items-end pointer-events-none"
      style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
      <div className="relative flex items-center gap-2 pointer-events-auto">
        {/* Nav tabs */}
        <div
          ref={containerRef}
          className="relative flex items-center p-1 rounded-2xl"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.15), 0 1px 0 rgba(255,255,255,0.05) inset",
          }}
        >
          {pill.w > 0 && (
            <div
              className="absolute top-1 bottom-1 rounded-xl"
              style={{
                width: pill.w,
                left: pill.x,
                backgroundColor: "var(--foreground)",
                transition: pill.animate
                  ? "left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)"
                  : "none",
              }}
            />
          )}

          {tabs.map((tab, i) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.name;
            return (
              <button
                key={tab.name}
                ref={(el) => { btnRefs.current[i] = el; }}
                onClick={() => onTabChange(tab.name)}
                className="relative z-10 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl"
                style={{
                  transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <Icon
                  size={17}
                  style={{
                    color: isActive ? "var(--background)" : "var(--muted-foreground)",
                    transition: "color 0.2s ease",
                  }}
                />
                <span
                  className="text-[9px] font-semibold tracking-wide"
                  style={{
                    color: isActive ? "var(--background)" : "var(--muted-foreground)",
                    transition: "color 0.2s ease",
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Add button */}
        <button
          onClick={onAdd}
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-90"
          style={{
            background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
            color: "var(--background)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.05) inset",
            transition: "transform 0.15s ease-out",
          }}
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
}
```

Note: icon size reduced from 18 to 17 and padding from `px-4` to `px-3` to fit 5 tabs comfortably.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/bottom-nav.tsx
git commit -m "feat: add Feed tab to bottom nav"
```

---

### Task 13: HomeClient — Feed Tab + Settings Reorg

**Files:**
- Modify: `frontend/components/home-client.tsx`

- [ ] **Step 1: Replace home-client.tsx with updated version**

```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { IdeaCard } from "@/components/ideas/idea-card";
import { CaptureSheet } from "@/components/ideas/capture-sheet";
import { SketchPad } from "@/components/sketch/sketch-pad";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { StatsView } from "@/components/stats/stats-view";
import { FeedView } from "@/components/feed/feed-view";
import { AvatarCircle } from "@/components/feed/avatar-circle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";
import { getCurrentUsername } from "@/lib/biometric";
import { fetchProfile, uploadAvatar } from "@/lib/api";
import { toast } from "sonner";

export function HomeClient() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const username = getCurrentUsername() ?? "";

  const { ideas, isLoading, mutate, addIdea, removeIdea, patchIdea, starIdea } = useIdeas();
  const search = useSearch(ideas);

  const starredIdeas = ideas.filter(i => i.starred);

  // Fetch profile when settings opens
  useEffect(() => {
    if (settingsOpen) {
      fetchProfile()
        .then((p) => setAvatarUrl(p.avatar_url))
        .catch(() => {});
    }
  }, [settingsOpen]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Optimistic preview
    const localUrl = URL.createObjectURL(file);
    setAvatarUrl(localUrl);
    try {
      const result = await uploadAvatar(file);
      setAvatarUrl(result.avatar_url);
    } catch {
      toast.error("Failed to upload avatar");
      setAvatarUrl(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <Header onSettingsClick={() => setSettingsOpen(true)} ideaCount={ideas.length} />

      <main className="px-4 pt-2 max-w-lg mx-auto">
        {activeTab === "ideas" && (
          <IdeaFeed
            ideas={ideas}
            isLoading={isLoading}
            onRefresh={() => mutate()}
            onStar={starIdea}
          />
        )}

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

        {activeTab === "feed" && <FeedView />}

        {activeTab === "starred" && (
          <div className="pt-2">
            {starredIdeas.length === 0 ? (
              <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
                <p className="text-sm">No starred ideas yet.</p>
                <p className="text-xs mt-1">Tap the star on any idea to save it here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {starredIdeas.map(idea => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onStar={(starred) => starIdea(idea.id, starred)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "categories" && (
          <div className="space-y-6 pt-2">
            <StatsView ideas={ideas} />
          </div>
        )}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} onAdd={() => setCaptureOpen(true)} />

      <CaptureSheet
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        onAdd={addIdea}
        onSketchOpen={() => {
          setCaptureOpen(false);
          setSketchOpen(true);
        }}
        sketchBlob={sketchBlob}
        clearSketch={() => setSketchBlob(null)}
      />

      <SketchPad
        open={sketchOpen}
        onClose={() => {
          setSketchOpen(false);
          setCaptureOpen(true);
        }}
        onSave={(blob) => {
          setSketchBlob(blob);
          setSketchOpen(false);
          setCaptureOpen(true);
        }}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--foreground)" }}>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-1">
            {/* Profile */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="relative active:opacity-70 transition-opacity"
              >
                <AvatarCircle username={username} avatarUrl={avatarUrl} size={72} />
                <div
                  className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
                >
                  <span className="text-white text-xs font-medium">Edit</span>
                </div>
              </button>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{username}</p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Tap to change photo</p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>

            {/* Face ID */}
            <BiometricToggle />

            {/* Theme */}
            <div>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
                Theme
              </p>
              <ThemeSelector />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/home-client.tsx
git commit -m "feat: add Feed tab, profile avatar, theme in settings"
```

---

### Task 14: Share Button on Idea Detail Page

**Files:**
- Modify: `frontend/app/ideas/[id]/page.tsx`

- [ ] **Step 1: Add share state and imports**

At the top of the file, add these imports after the existing imports:

```typescript
import { shareIdea, unshareIdea } from "@/lib/api";
import { ShareConfirmSheet } from "@/components/feed/share-confirm-sheet";
import { getCurrentUsername } from "@/lib/biometric";
import { Share2 } from "lucide-react";
```

- [ ] **Step 2: Add share state variables inside the component**

After the existing `useState` declarations (after `const [starring, setStarring] = useState(false);`):

```typescript
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [isShared, setIsShared] = useState<boolean | null>(null);
  const currentUsername = getCurrentUsername();
```

- [ ] **Step 3: Sync isShared from idea data**

Add a `useEffect` after the existing hooks (after the `useSWR` calls):

```typescript
  useEffect(() => {
    if (idea) setIsShared(idea.is_shared);
  }, [idea?.is_shared]);
```

- [ ] **Step 4: Add handleShare and handleUnshare functions**

After `handleDelete`:

```typescript
  const handleShare = async () => {
    if (!idea) return;
    setIsShared(true); // optimistic
    try {
      await shareIdea(idea.id);
      globalMutate("feed").catch(() => {});
    } catch {
      setIsShared(false);
      toast.error("Failed to share.");
    }
  };

  const handleUnshare = async () => {
    if (!idea) return;
    setIsShared(false); // optimistic
    try {
      await unshareIdea(idea.id);
      globalMutate("feed").catch(() => {});
    } catch {
      setIsShared(true);
      toast.error("Failed to unshare.");
    }
  };
```

- [ ] **Step 5: Add the share button and confirmation sheet**

In the JSX, inside the `{idea && (...)}` block, after the last media/content section and before the closing `</div>`, add:

```tsx
          {/* Share to feed — only shown for own ideas */}
          {idea.owner_username === currentUsername && isShared !== null && (
            <div>
              {isShared ? (
                <button
                  onClick={handleUnshare}
                  className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  <Share2 size={15} />
                  Shared to feed · Remove
                </button>
              ) : (
                <button
                  onClick={() => setShareSheetOpen(true)}
                  className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                >
                  <Share2 size={15} />
                  Share to feed
                </button>
              )}
            </div>
          )}
```

Also add the `ShareConfirmSheet` just before the closing `</div>` of the entire component (after the lightbox):

```tsx
      <ShareConfirmSheet
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        onConfirm={handleShare}
        content={idea?.content ?? ""}
      />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/ideas/[id]/page.tsx
git commit -m "feat: add share/unshare button to idea detail page"
```

---

### Task 15: Build and Deploy

**Files:** None (build only)

- [ ] **Step 1: Build and deploy Flask (DB migrations + new endpoints)**

```bash
cd /home/ardi/Projects/think_tank
docker compose build --no-cache flask && docker compose up -d --force-recreate flask
docker logs think_tank_api --tail=20
```

Expected: clean startup, no errors.

- [ ] **Step 2: Build and deploy Next.js frontend**

```bash
docker compose build --no-cache nextjs 2>&1 | tail -20
docker compose up -d --force-recreate nextjs
docker logs think_tank_frontend --tail=10
```

Expected: build succeeds, Next.js starts on port 3004.

- [ ] **Step 3: Smoke test**

1. Open the app → confirm 5 tabs appear in bottom nav: Ideas, Search, Feed, Starred, Stats
2. Open Settings (gear icon) → confirm avatar circle at top, Face ID toggle, Theme selector at bottom
3. Open any idea detail → confirm "Share to feed" button appears for your own ideas
4. Tap "Share to feed" → confirm bottom sheet appears with idea preview and "Is this worth sharing?" prompt
5. Tap Share → button changes to "Shared to feed · Remove"
6. Switch to Feed tab → post appears with avatar/initials + username + content
7. Tap Remove on the post → post disappears from feed

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: shared feed + user profiles complete"
```
