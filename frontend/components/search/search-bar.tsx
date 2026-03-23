"use client";

import { Search } from "lucide-react";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onDeepSearch: () => void;
  isSearchingDeep: boolean;
}

export function SearchBar({ query, onQueryChange, onDeepSearch, isSearchingDeep }: SearchBarProps) {
  return (
    <div className="relative mb-4">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2.5"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <Search size={16} style={{ color: "var(--muted-foreground)" }} />
        <input
          type="text"
          placeholder="Search ideas..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onDeepSearch();
          }}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "var(--foreground)" }}
        />
        {query.trim() && (
          <button
            onClick={onDeepSearch}
            disabled={isSearchingDeep}
            className="text-xs font-medium px-2.5 py-1 rounded-md"
            style={{
              backgroundColor: "var(--muted)",
              color: "var(--foreground)",
            }}
          >
            {isSearchingDeep ? "..." : "Deep"}
          </button>
        )}
      </div>
    </div>
  );
}
