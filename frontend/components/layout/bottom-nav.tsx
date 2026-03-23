"use client";

import { Lightbulb, Search, FolderOpen } from "lucide-react";

export type TabName = "ideas" | "search" | "categories";

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

const tabs: { name: TabName; icon: typeof Lightbulb; label: string }[] = [
  { name: "ideas", icon: Lightbulb, label: "Ideas" },
  { name: "search", icon: Search, label: "Search" },
  { name: "categories", icon: FolderOpen, label: "Categories" },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-around pb-5 pt-2"
      style={{
        backgroundColor: "var(--background)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.name}
            onClick={() => onTabChange(tab.name)}
            className="flex flex-col items-center gap-0.5 px-4 py-1"
          >
            <Icon
              size={20}
              style={{
                color: activeTab === tab.name ? "var(--foreground)" : "var(--muted-foreground)",
              }}
            />
            <span
              className="text-[10px] font-medium"
              style={{
                color: activeTab === tab.name ? "var(--foreground)" : "var(--muted-foreground)",
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
