"use client";

import { memo } from "react";
import type { Idea } from "@/lib/types";
import { CategoryBadge } from "@/components/categories/category-badge";
import { SpotlightCard } from "@/components/ui/spotlight";
import { formatTime } from "@/lib/utils/dates";

interface IdeaCardProps {
  idea: Idea;
  onClick?: () => void;
}

export const IdeaCard = memo(function IdeaCard({ idea, onClick }: IdeaCardProps) {
  return (
    <SpotlightCard
      className="rounded-xl"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
    <button
      onClick={onClick}
      className="w-full text-left p-3.5"
    >
      {idea.content && (
        <p className="text-sm leading-relaxed mb-2" style={{ color: "var(--foreground)" }}>
          {idea.content}
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

      <div className="flex items-center justify-between">
        {idea.category ? (
          <CategoryBadge name={idea.category.name} color={idea.category.color} />
        ) : (
          <span />
        )}
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {formatTime(idea.timestamp)}
        </span>
      </div>
    </button>
    </SpotlightCard>
  );
});
