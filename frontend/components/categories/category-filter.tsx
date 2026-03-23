"use client";

import type { Category } from "@/lib/types";

interface CategoryFilterProps {
  categories: Category[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className="px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
        style={{
          backgroundColor: selected === null ? "var(--foreground)" : "var(--card)",
          color: selected === null ? "var(--background)" : "var(--muted-foreground)",
          border: selected === null ? "none" : "1px solid var(--border)",
        }}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className="px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
          style={{
            backgroundColor: selected === cat.id ? "var(--foreground)" : "var(--card)",
            color: selected === cat.id ? "var(--background)" : "var(--muted-foreground)",
            border: selected === cat.id ? "none" : "1px solid var(--border)",
          }}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
