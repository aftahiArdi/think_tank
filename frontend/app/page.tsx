"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { Fab } from "@/components/layout/fab";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { CaptureSheet } from "@/components/ideas/capture-sheet";
import { SketchPad } from "@/components/sketch/sketch-pad";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { CategoryManager } from "@/components/categories/category-manager";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);

  const { ideas, isLoading } = useIdeas();
  const search = useSearch(ideas);

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: "var(--background)" }}>
      <Header onSettingsClick={() => setSettingsOpen(true)} />

      <main className="px-4 pt-2">
        {activeTab === "ideas" && (
          <IdeaFeed ideas={ideas} isLoading={isLoading} />
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

      <Fab onClick={() => setCaptureOpen(true)} />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <ThemeSelector />
        </DialogContent>
      </Dialog>
    </div>
  );
}
