"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { IdeaCard } from "@/components/ideas/idea-card";
import { CaptureSheet } from "@/components/ideas/capture-sheet";
import { SketchPad } from "@/components/sketch/sketch-pad";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { StatsView } from "@/components/stats/stats-view";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);

  const { ideas, isLoading, mutate, addIdea, removeIdea, patchIdea, starIdea } = useIdeas();
  const search = useSearch(ideas);

  const starredIdeas = ideas.filter(i => i.starred);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <Header onSettingsClick={() => setSettingsOpen(true)} ideaCount={ideas.length} />

      <main className="px-4 pt-2 max-w-lg mx-auto">
        {activeTab === "ideas" && (
          <IdeaFeed
            ideas={ideas}
            isLoading={isLoading}
            onRefresh={() => mutate()}
            onStar={starIdea}
          />
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

        {activeTab === "starred" && (
          <div className="pt-2">
            {starredIdeas.length === 0 ? (
              <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
                <p className="text-sm">No starred ideas yet.</p>
                <p className="text-xs mt-1">Tap the star on any idea to save it here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {starredIdeas.map(idea => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onStar={(starred) => starIdea(idea.id, starred)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "categories" && (
          <div className="space-y-6 pt-2">
            <ThemeSelector />
            <StatsView ideas={ideas} />
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
            <BiometricToggle />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
