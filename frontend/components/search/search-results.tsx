"use client";

import type { Idea, SearchResult } from "@/lib/types";
import { IdeaCard } from "@/components/ideas/idea-card";
import { CategoryBadge } from "@/components/categories/category-badge";
import { formatTime } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";

interface SearchResultsProps {
  mode: "fuzzy" | "semantic";
  fuzzyResults: Idea[];
  semanticResults: SearchResult[];
  isSearchingDeep: boolean;
  query: string;
}

export function SearchResults({
  mode,
  fuzzyResults,
  semanticResults,
  isSearchingDeep,
  query,
}: SearchResultsProps) {
  if (!query.trim()) {
    return (
      <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
        Search your ideas — type to search instantly, press Enter for deep semantic search
      </div>
    );
  }

  if (isSearchingDeep) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (mode === "semantic" && semanticResults.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
          Semantic results
        </p>
        {semanticResults.map((result) => (
          <div
            key={result.id}
            className="p-3.5 rounded-xl"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <p className="text-sm mb-2" style={{ color: "var(--foreground)" }}>
              {result.content}
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.category && (
                  <CategoryBadge name={result.category.name} color={result.category.color} />
                )}
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--muted)",
                    color: "var(--foreground)",
                  }}
                >
                  {Math.round(result.similarity * 100)}% match
                </span>
              </div>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {formatTime(result.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (fuzzyResults.length > 0) {
    return (
      <div className="space-y-2">
        {fuzzyResults.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
    );
  }

  return (
    <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
      No results found. Try a different search or press Enter for deep search.
    </div>
  );
}
