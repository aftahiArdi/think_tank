export interface IdeaMedia {
  id: number;
  filename: string;
  media_type: "image" | "sketch" | "video";
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
  media_type: "text" | "image" | "sketch" | "video" | "mixed";
  has_media: boolean;
  category: Category | null;
  media: IdeaMedia[];
}

export interface SearchResult {
  id: number;
  content: string;
  timestamp: string;
  similarity: number;
  category: Category | null;
}

export type ThemeName = "minimal-dark" | "soft-neutral" | "glass-modern";
