"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { CaptureSheet } from "@/components/ideas/capture-sheet";
import { SketchPad } from "@/components/sketch/sketch-pad";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { CategoryManager } from "@/components/categories/category-manager";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";
import type { Idea } from "@/lib/types";

function SettingsStats({ ideas }: { ideas: Idea[] }) {
  const todayKey = new Date().toLocaleDateString("en-CA");
  const todayCount = ideas.filter((i) => i.timestamp.startsWith(todayKey)).length;
  const stats = [
    { label: "Total ideas", value: ideas.length },
    { label: "Today", value: todayCount },
    { label: "With media", value: ideas.filter((i) => i.has_media).length },
  ];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>
        Stats
      </p>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl px-3 py-3 text-center"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
              {value}
            </p>
            <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "var(--muted-foreground)" }}>
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);

  const { ideas, isLoading, mutate } = useIdeas();
  const search = useSearch(ideas);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <Header onSettingsClick={() => setSettingsOpen(true)} ideaCount={ideas.length} />

      <main className="px-4 pt-2 max-w-lg mx-auto">
        {activeTab === "ideas" && (
          <IdeaFeed ideas={ideas} isLoading={isLoading} onRefresh={() => mutate()} />
        )}

        {activeTab === "search" && (
          <>
            <SearchBar
              query={search.query}
              onQueryChange={search.setQuery}
              onDeepSearch={search.triggerDeepSearch}
              isSearchingDeep={search.isSearchingDeep}
            />
            <SearchResults
              mode={search.mode}
              fuzzyResults={search.fuzzyResults}
              semanticResults={search.semanticResults}
              isSearchingDeep={search.isSearchingDeep}
              query={search.query}
            />
          </>
        )}

        {activeTab === "categories" && (
          <div className="space-y-6 pt-2">
            <ThemeSelector />
            <div>
              <p className="text-[11px] uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>
                Categories
              </p>
              <CategoryManager />
            </div>
          </div>
        )}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} onAdd={() => setCaptureOpen(true)} />

      <CaptureSheet
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        onSketchOpen={() => {
          setCaptureOpen(false);
          setSketchOpen(true);
        }}
        sketchBlob={sketchBlob}
        clearSketch={() => setSketchBlob(null)}
      />

      <SketchPad
        open={sketchOpen}
        onClose={() => {
          setSketchOpen(false);
          setCaptureOpen(true);
        }}
        onSave={(blob) => {
          setSketchBlob(blob);
          setSketchOpen(false);
          setCaptureOpen(true);
        }}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--foreground)" }}>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-1">
            <ThemeSelector />
            <BiometricToggle />
            <SettingsStats ideas={ideas} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
