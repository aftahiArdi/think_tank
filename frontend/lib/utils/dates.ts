import type { Idea } from "@/lib/types";

export function formatDate(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function groupByDate(ideas: Idea[]): Map<string, Idea[]> {
  const groups = new Map<string, Idea[]>();
  for (const idea of ideas) {
    const dateKey = idea.timestamp.split(" ")[0]; // "YYYY-MM-DD"
    const existing = groups.get(dateKey) || [];
    existing.push(idea);
    groups.set(dateKey, existing);
  }
  return groups;
}
