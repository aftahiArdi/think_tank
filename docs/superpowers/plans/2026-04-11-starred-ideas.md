# Starred Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to star/favourite ideas, accessible from the idea card, the detail page, and a dedicated Starred tab in the bottom nav.

**Architecture:** Add a `starred` SQLite column with a migration guard, expose it via a new `PATCH /ideas/<id>/star` Flask endpoint, thread `starIdea` through the SWR hook with optimistic updates, add a star button to `IdeaCard` and the detail page, and add a fourth tab to the bottom nav that renders a client-side-filtered list of starred ideas.

**Tech Stack:** Flask + SQLite (backend), Next.js App Router + SWR + TypeScript + Tailwind + lucide-react (frontend), Docker Compose (deploy)

---

### Task 1: Backend — migration, serialisation, star endpoint

**Files:**
- Modify: `app.py` (init_db migration block ~line 68, list_ideas ~line 286, get_idea ~line 371, add new route after line 448)

- [ ] **Step 1: Add `starred` migration to `init_db()`**

In `app.py`, inside `init_db()`, right after the existing `if "category_id" not in ideas_cols:` block (~line 78), add:

```python
    if "starred" not in ideas_cols:
        cursor.execute("ALTER TABLE ideas ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")
```

- [ ] **Step 2: Add `starred` to `list_ideas()` serialisation**

In `list_ideas()` (~line 288), the `idea` dict is built. Add `starred` to it:

```python
        idea = {
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),   # add this line
            'category': None,
            'media': media_by_idea.get(row['id'], [])
        }
```

Also update the SELECT in `list_ideas()` to include `i.starred` (~line 265):

```python
        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            ORDER BY i.timestamp DESC
        ''')
```

- [ ] **Step 3: Add `starred` to `get_idea()` serialisation**

In `get_idea()` (~line 344), update the SELECT:

```python
        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.id = ?
        ''', (idea_id,))
```

And add `starred` to the `idea` dict returned at ~line 371:

```python
        idea = {
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),   # add this line
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }
```

- [ ] **Step 4: Add `PATCH /ideas/<id>/star` endpoint**

Add this new route after the `delete_idea` route (~line 448):

```python
@app.route('/ideas/<int:idea_id>/star', methods=['PATCH'])
def star_idea(idea_id):
    data = request.get_json()
    starred = bool(data.get('starred', False))
    try:
        conn = sqlite3.connect('notes.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('UPDATE ideas SET starred = ? WHERE id = ?', (int(starred), idea_id))
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Idea not found.'}), 404
        conn.commit()

        # Return full idea object
        cursor.execute('''
            SELECT i.id, i.content, i.timestamp, i.media_type, i.has_media, i.starred, i.category_id,
                   c.name as category_name, c.color as category_color
            FROM ideas i
            LEFT JOIN categories c ON i.category_id = c.id
            WHERE i.id = ?
        ''', (idea_id,))
        row = cursor.fetchone()
        cursor.execute(
            'SELECT id, filename, media_type, file_size FROM idea_media WHERE idea_id = ?',
            (idea_id,)
        )
        media = [{
            'id': m['id'],
            'filename': m['filename'],
            'media_type': m['media_type'],
            'file_size': m['file_size'],
            'url': f"/api/flask/uploads/{m['filename']}"
        } for m in cursor.fetchall()]
        conn.close()

        return jsonify({
            'id': row['id'],
            'content': row['content'],
            'timestamp': row['timestamp'],
            'media_type': row['media_type'] or 'text',
            'has_media': bool(row['has_media']),
            'starred': bool(row['starred']),
            'category': {'id': row['category_id'], 'name': row['category_name'], 'color': row['category_color']} if row['category_id'] else None,
            'media': media,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 5: Verify manually**

Rebuild Flask and hit the endpoint:
```bash
cd /home/ardi/Projects/think_tank
docker compose build --no-cache flask && docker compose up -d --force-recreate flask
curl -s http://localhost:6000/ideas | python3 -c "import sys,json; ideas=json.load(sys.stdin)['ideas']; print('starred key present:', 'starred' in ideas[0])"
# Expected: starred key present: True
curl -s -X PATCH http://localhost:6000/ideas/1/star \
  -H "Content-Type: application/json" \
  -d '{"starred": true}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('starred:', d.get('starred'))"
# Expected: starred: True
```

- [ ] **Step 6: Commit**

```bash
git add app.py
git commit -m "feat: add starred column to ideas, PATCH /ideas/<id>/star endpoint"
```

---

### Task 2: Frontend types and API function

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `starred` to the `Idea` interface in `frontend/lib/types.ts`**

```ts
export interface Idea {
  id: number;
  content: string;
  timestamp: string;
  media_type: "text" | "image" | "sketch" | "video" | "mixed";
  has_media: boolean;
  starred: boolean;
  category: Category | null;
  media: IdeaMedia[];
}
```

- [ ] **Step 2: Add `starIdea` to `frontend/lib/api.ts`**

Add after `deleteIdea`:

```ts
export async function starIdea(id: number, starred: boolean): Promise<import("./types").Idea> {
  const res = await fetch(`${API_BASE}/ideas/${id}/star`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starred }),
  });
  return handleResponse<import("./types").Idea>(res);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: add starred to Idea type and starIdea API function"
```

---

### Task 3: Hook — add `starIdea` to `use-ideas.ts`

**Files:**
- Modify: `frontend/lib/hooks/use-ideas.ts`

- [ ] **Step 1: Add `starIdea` to `use-ideas.ts`**

Replace the entire file with:

```ts
import useSWR from "swr";
import { fetchIdeas, createIdea, deleteIdea, updateIdea, starIdea as apiStarIdea } from "@/lib/api";
import type { Idea } from "@/lib/types";

export function useIdeas() {
  const { data, error, isLoading, mutate } = useSWR("ideas", () => fetchIdeas());

  const ideas = data?.ideas ?? [];

  const addIdea = async (content: string, categoryId?: number) => {
    const tempId = -Date.now();
    const optimistic: Idea = {
      id: tempId,
      content,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      media_type: "text",
      has_media: false,
      starred: false,
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

  const starIdea = async (id: number, starred: boolean) => {
    const optimistic = ideas.map(i => i.id === id ? { ...i, starred } : i);
    mutate(
      async () => {
        await apiStarIdea(id, starred);
        return { ideas: optimistic, total: ideas.length };
      },
      {
        optimisticData: { ideas: optimistic, total: ideas.length },
        rollbackOnError: true,
      }
    );
  };

  return { ideas, isLoading, error, mutate, addIdea, removeIdea, patchIdea, starIdea };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/hooks/use-ideas.ts
git commit -m "feat: add starIdea with optimistic update to useIdeas hook"
```

---

### Task 4: IdeaCard — add star button

**Files:**
- Modify: `frontend/components/ideas/idea-card.tsx`

- [ ] **Step 1: Rewrite `idea-card.tsx` with star button**

```tsx
"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { Idea } from "@/lib/types";
import { GlowCard } from "@/components/ui/glow-card";
import { formatTime } from "@/lib/utils/dates";

interface IdeaCardProps {
  idea: Idea;
  onClick?: () => void;
  onStar?: (starred: boolean) => void;
}

const URL_REGEX = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

function linkify(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        style={{ color: "var(--primary, #6366f1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {match[0]}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export const IdeaCard = memo(function IdeaCard({ idea, onClick, onStar }: IdeaCardProps) {
  const router = useRouter();
  const handleClick = onClick ?? (() => router.push(`/ideas/${idea.id}`));
  return (
    <GlowCard onClick={handleClick}>
      <div className="relative w-full text-left px-3.5 py-3">
        {/* Star button */}
        {onStar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStar(!idea.starred);
            }}
            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg"
            style={{ color: idea.starred ? "#facc15" : "var(--muted-foreground)" }}
          >
            <Star
              size={15}
              fill={idea.starred ? "#facc15" : "none"}
              strokeWidth={idea.starred ? 0 : 1.5}
            />
          </button>
        )}

        {idea.content && (
          <p
            className="text-sm leading-relaxed mb-2"
            style={{ color: "var(--foreground)", paddingRight: onStar ? "1.5rem" : 0 }}
          >
            {linkify(idea.content)}
          </p>
        )}

        {idea.has_media && idea.media.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto">
            {idea.media.map((m) =>
              m.media_type === "video" ? (
                <div
                  key={m.id}
                  className="w-20 h-20 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl"
                  style={{ backgroundColor: "var(--muted)" }}
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

        <div className="flex items-center justify-end">
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            {formatTime(idea.timestamp)}
          </span>
        </div>
      </div>
    </GlowCard>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ideas/idea-card.tsx
git commit -m "feat: add star button to IdeaCard"
```

---

### Task 5: IdeaFeed — thread `onStar` prop

**Files:**
- Modify: `frontend/components/ideas/idea-feed.tsx`

- [ ] **Step 1: Add `onStar` to `IdeaFeedProps` and pass to `IdeaCard`**

Change the `IdeaFeedProps` interface (around line 14):

```ts
interface IdeaFeedProps {
  ideas: Idea[];
  isLoading: boolean;
  onRefresh?: () => Promise<unknown>;
  onStar?: (id: number, starred: boolean) => void;
}
```

Update the function signature:

```ts
export function IdeaFeed({ ideas, isLoading, onRefresh, onStar }: IdeaFeedProps) {
```

Update the `IdeaCard` render call (around line 234):

```tsx
<IdeaCard
  key={idea.id}
  idea={idea}
  onStar={onStar ? (starred) => onStar(idea.id, starred) : undefined}
/>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ideas/idea-feed.tsx
git commit -m "feat: thread onStar prop through IdeaFeed to IdeaCard"
```

---

### Task 6: Idea detail page — add star button

**Files:**
- Modify: `frontend/app/ideas/[id]/page.tsx`

- [ ] **Step 1: Import `Star` and `starIdea`**

Change the lucide import line (~line 6):

```ts
import { ArrowLeft, Trash2, Calendar, Clock, Copy, Check, Star } from "lucide-react";
```

Change the api import line (~line 7):

```ts
import { fetchIdeas, fetchIdea, deleteIdea, starIdea } from "@/lib/api";
```

- [ ] **Step 2: Add star toggle state and handler**

Add after `const [lightbox, setLightbox] = useState<string | null>(null);` (~line 61):

```ts
const [starring, setStarring] = useState(false);
```

Add after `handleDelete` function (~line 84):

```ts
  const handleStar = async () => {
    if (!idea || starring) return;
    setStarring(true);
    try {
      await starIdea(idea.id, !idea.starred);
      globalMutate("ideas").catch(() => {});
      globalMutate(`idea-${ideaId}`).catch(() => {});
    } catch {
      toast.error("Failed to update star.");
    } finally {
      setStarring(false);
    }
  };
```

- [ ] **Step 3: Add star button to the header action row**

The header currently has just the trash button on the right. Add the star button to its left. Replace the `{idea && (...)}` block in the header (~line 107):

```tsx
        {idea && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleStar}
              disabled={starring}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: idea.starred ? "#facc15" : "var(--muted-foreground)",
              }}
            >
              <Star
                size={15}
                fill={idea.starred ? "#facc15" : "none"}
                strokeWidth={idea.starred ? 0 : 1.5}
              />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <Trash2 size={15} style={{ color: "var(--destructive)" }} />
            </button>
          </div>
        )}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/ideas/[id]/page.tsx
git commit -m "feat: add star toggle to idea detail page"
```

---

### Task 7: Bottom nav — add Starred tab

**Files:**
- Modify: `frontend/components/layout/bottom-nav.tsx`

- [ ] **Step 1: Rewrite `bottom-nav.tsx` with Starred tab**

```tsx
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Search, Bookmark, FolderOpen, Plus } from "lucide-react";

export type TabName = "ideas" | "search" | "starred" | "categories";

const tabs: { name: TabName; icon: typeof Lightbulb; label: string }[] = [
  { name: "ideas",      icon: Lightbulb,  label: "Ideas"    },
  { name: "search",     icon: Search,     label: "Search"   },
  { name: "starred",    icon: Bookmark,   label: "Starred"  },
  { name: "categories", icon: FolderOpen, label: "Settings" },
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
                className="relative z-10 flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl"
                style={{
                  transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <Icon
                  size={18}
                  style={{
                    color: isActive ? "var(--background)" : "var(--muted-foreground)",
                    transition: "color 0.2s ease",
                  }}
                />
                <span
                  className="text-[10px] font-semibold tracking-wide"
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

Note: reduced `px-6` to `px-4` on each tab button so 4 tabs fit comfortably in the pill.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/bottom-nav.tsx
git commit -m "feat: add Starred tab to bottom nav"
```

---

### Task 8: page.tsx — wire `starIdea` through + starred tab content

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Rewrite `page.tsx`**

```tsx
"use client";

import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);

  const { ideas, isLoading, mutate, addIdea, removeIdea, patchIdea, starIdea } = useIdeas();
  const search = useSearch(ideas);

  const starredIdeas = ideas.filter(i => i.starred);

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
            <ThemeSelector />
            <StatsView ideas={ideas} />
          </div>
        )}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} onAdd={() => setCaptureOpen(true)} />

      <CaptureSheet
        open={captureOpen}
        onOpenChange={setCaptureOpen}
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
            <BiometricToggle />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: wire starIdea through page, add starred tab content"
```

---

### Task 9: Rebuild and deploy

- [ ] **Step 1: Rebuild Next.js Docker image**

```bash
cd /home/ardi/Projects/think_tank
docker compose build --no-cache nextjs 2>&1 | tail -5
# Expected: Image think_tank-nextjs Built
```

- [ ] **Step 2: Restart container**

```bash
docker compose up -d --force-recreate nextjs
# Expected: Container think_tank_frontend Started
```

- [ ] **Step 3: Smoke test**

Open http://localhost:3004 in a browser:
1. Ideas tab loads — star icons appear on each card (outline, muted colour)
2. Tap a star on a card — icon fills yellow immediately (optimistic)
3. Navigate to Starred tab — starred idea appears
4. Open the idea detail page — star icon shows in header, filled yellow
5. Tap the star in the detail — toggles, Starred tab updates on return
6. Tap a filled star in the feed — unstar works, idea disappears from Starred tab
