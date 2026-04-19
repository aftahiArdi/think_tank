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
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
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
  viewer_starred: boolean;
}

export interface FeedIdeaDetail {
  id: number;
  content: string;
  timestamp: string;
  media_type: string;
  has_media: boolean;
  shared_at: string;
  author: { username: string; avatar_url: string | null };
  is_mine: boolean;
  viewer_starred: boolean;
  category: { id: number; name: string; color: string } | null;
  media: IdeaMedia[];
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

export interface Mood {
  id: number;
  mood_value: number;
  timestamp: string;
  label: string | null;
  cause: string | null;
  idea_id: number | null;
}

export interface MoodHistory {
  moods: Mood[];
  average: number | null;
  average_label: string | null;
}
