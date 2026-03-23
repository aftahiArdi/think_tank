"use client";

import { useMemo, useState } from "react";
import type { Idea } from "@/lib/types";
import { IdeaCard } from "./idea-card";
import { CategoryFilter } from "@/components/categories/category-filter";
import { useCategories } from "@/lib/hooks/use-categories";
import { formatDate } from "@/lib/utils/dates";
import { Skeleton } from "@/components/ui/skeleton";

interface IdeaFeedProps {
  ideas: Idea[];
  isLoading: boolean;
}

export function IdeaFeed({ ideas, isLoading }: IdeaFeedProps) {
  const { categories } = useCategories();
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const filteredIdeas = useMemo(() => {
    if (selectedCategory === null) return ideas;
    return ideas.filter((i) => i.category?.id === selectedCategory);
  }, [ideas, selectedCategory]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { date: string; label: string; ideas: Idea[] }[] = [];
    let currentDate = "";

    for (const idea of filteredIdeas) {
      const dateKey = idea.timestamp.split(" ")[0];
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({
          date: dateKey,
          label: formatDate(idea.timestamp),
          ideas: [],
        });
      }
      groups[groups.length - 1].ideas.push(idea);
    }

    return groups;
  }, [filteredIdeas]);

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <CategoryFilter
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />

      {filteredIdeas.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
          {selectedCategory ? "No ideas in this category" : "No ideas yet. Tap + to add one!"}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.date}>
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--muted-foreground)" }}
              >
                {group.label}
              </p>
              <div className="space-y-2">
                {group.ideas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
