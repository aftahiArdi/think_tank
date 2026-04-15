const API_BASE = "/api/flask";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchIdeas(before?: string, limit: number = 50) {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/ideas?${params.toString()}`);
  return handleResponse<{ ideas: import("./types").Idea[]; next_before: string | null }>(res);
}

export async function createIdea(content: string, categoryId?: number) {
  const res = await fetch(`${API_BASE}/ideas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, category_id: categoryId }),
  });
  return handleResponse<{ id: number; message: string }>(res);
}

export async function fetchIdea(id: number) {
  const res = await fetch(`${API_BASE}/ideas/${id}`);
  return handleResponse<import("./types").Idea>(res);
}

export async function fetchRandomIdea(excludeHours: number = 24) {
  const res = await fetch(`${API_BASE}/ideas/random?exclude_hours=${excludeHours}`);
  return handleResponse<{ idea: import("./types").Idea | null }>(res);
}

export async function fetchOnThisDay() {
  const res = await fetch(`${API_BASE}/ideas/on-this-day`);
  return handleResponse<{ ideas: import("./types").Idea[] }>(res);
}

export async function fetchStarredIdeas() {
  const res = await fetch(`${API_BASE}/ideas/starred`);
  return handleResponse<{ ideas: import("./types").Idea[] }>(res);
}

export async function fetchStatsData() {
  const res = await fetch(`${API_BASE}/ideas/stats-data`);
  return handleResponse<{ ideas: import("./types").Idea[] }>(res);
}

export async function updateIdea(id: number, data: { content?: string; category_id?: number }) {
  const res = await fetch(`${API_BASE}/ideas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

export async function deleteIdea(id: number) {
  const res = await fetch(`${API_BASE}/ideas/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}

export async function starIdea(id: number, starred: boolean): Promise<import("./types").Idea> {
  const res = await fetch(`${API_BASE}/ideas/${id}/star`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starred }),
  });
  return handleResponse<import("./types").Idea>(res);
}

export async function searchIdeas(query: string) {
  const res = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return handleResponse<{ results: import("./types").SearchResult[] }>(res);
}

export async function uploadFile(ideaId: number, file: File) {
  const formData = new FormData();
  formData.append("idea_id", ideaId.toString());
  formData.append("file", file, file.name);
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<{ id: number; filename: string; url: string }>(res);
}

export function uploadFileWithProgress(
  ideaId: number,
  file: File,
  onProgress: (fraction: number) => void
): Promise<{ id: number; filename: string; url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("idea_id", ideaId.toString());
    formData.append("file", file, file.name);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response"));
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `Request failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Request failed: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

    xhr.open("POST", `${API_BASE}/upload`);
    xhr.send(formData);
  });
}

export interface DailySummary {
  date: string;
  summary: string | null;
  idea_count?: number;
  created_at?: string;
  cached?: boolean;
}

export async function fetchDailySummary(date?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const res = await fetch(`${API_BASE}/summary/daily${params.toString() ? `?${params}` : ""}`);
  return handleResponse<DailySummary>(res);
}

export interface DailySummaryEntry {
  date: string;
  summary: string;
  idea_count: number;
  created_at: string;
}

export async function fetchIdeasByDate(date: string) {
  const res = await fetch(`${API_BASE}/ideas/by-date?date=${encodeURIComponent(date)}`);
  return handleResponse<{ ideas: import("./types").Idea[] }>(res);
}

export async function fetchAllDailySummaries() {
  const res = await fetch(`${API_BASE}/summary/daily/all`);
  return handleResponse<{ summaries: DailySummaryEntry[] }>(res);
}

export async function generateDailySummary(force = false, date?: string) {
  const res = await fetch(`${API_BASE}/summary/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force, date }),
  });
  return handleResponse<DailySummary>(res);
}

export async function transcribeAudio(ideaId: number) {
  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea_id: ideaId }),
  });
  return handleResponse<{ id: number; content: string; transcription: string }>(res);
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/categories`);
  return handleResponse<{ categories: import("./types").Category[] }>(res);
}

export async function createCategory(name: string, color: string) {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return handleResponse<{ id: number; message: string }>(res);
}

export async function updateCategory(id: number, data: { name?: string; color?: string }) {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

export async function deleteCategory(id: number) {
  const res = await fetch(`${API_BASE}/categories/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}

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

export async function starFeedPost(ideaId: number) {
  const res = await fetch(`${API_BASE}/feed/star/${ideaId}`, { method: "POST" });
  return handleResponse<{ message: string }>(res);
}

export async function unstarFeedPost(ideaId: number) {
  const res = await fetch(`${API_BASE}/feed/star/${ideaId}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
}

export async function fetchStarredFeedPosts() {
  const res = await fetch(`${API_BASE}/feed/starred`);
  return handleResponse<{ posts: import("./types").FeedPost[] }>(res);
}

export async function fetchFeedIdea(ideaId: number) {
  const res = await fetch(`${API_BASE}/feed/ideas/${ideaId}`);
  return handleResponse<import("./types").FeedIdeaDetail>(res);
}
