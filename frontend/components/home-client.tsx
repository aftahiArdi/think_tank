"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { fetchStarredIdeas } from "@/lib/api";
import { Header } from "@/components/layout/header";
import { BottomNav, type TabName } from "@/components/layout/bottom-nav";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { IdeaCard } from "@/components/ideas/idea-card";
import { CaptureSheet } from "@/components/ideas/capture-sheet";
import { MoodSheet } from "@/components/mood/mood-sheet";
import { SketchPad } from "@/components/sketch/sketch-pad";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { StatsView } from "@/components/stats/stats-view";
import { SummariesView } from "@/components/summaries/summaries-view";
import { FeedView } from "@/components/feed/feed-view";
import { FeedPostCard } from "@/components/feed/feed-post-card";
import { AvatarCircle } from "@/components/feed/avatar-circle";
import { useStarredFeedPosts } from "@/lib/hooks/use-feed";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { useSearch } from "@/lib/hooks/use-search";
import { getCurrentUsername } from "@/lib/biometric";
import { fetchProfile, uploadAvatar } from "@/lib/api";
import { toast } from "sonner";

export function HomeClient() {
  const [activeTab, setActiveTab] = useState<TabName>("ideas");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchBlob, setSketchBlob] = useState<Blob | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [starredSort, setStarredSort] = useState<"desc" | "asc">("desc");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // PWA home-screen shortcuts (manifest.json `shortcuts`) launch the app with
  // ?capture=text|sketch|voice. Handle those on mount, then strip the query
  // so a reload doesn't re-trigger the sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const capture = params.get("capture");
    if (!capture) return;
    if (capture === "text") {
      setCaptureOpen(true);
    } else if (capture === "sketch") {
      setSketchOpen(true);
    } else if (capture === "voice") {
      setAutoRecord(true);
      setCaptureOpen(true);
    }
    params.delete("capture");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState(null, "", clean);
  }, []);

  const username = getCurrentUsername() ?? "";

  const { ideas, isLoading, mutate, addIdea, removeIdea, patchIdea, starIdea, loadMore, hasMore } = useIdeas();
  const search = useSearch(ideas);
  const { posts: starredFeedPosts, unstarPost } = useStarredFeedPosts();

  // Starred ideas come from their own endpoint so the tab covers the user's full
  // history, not just the currently-paginated feed. Only fetched when the starred
  // tab is opened to keep cold-start cost off the main feed.
  const { data: starredResp, mutate: mutateStarred } = useSWR(
    activeTab === "starred" ? "starred-ideas" : null,
    () => fetchStarredIdeas(),
  );
  const starredIdeasRaw = starredResp?.ideas ?? ideas.filter(i => i.starred);
  // Timestamps are stored as "YYYY-MM-DD HH:MM:SS" — lexicographic compare matches chronological.
  const starredIdeas = [...starredIdeasRaw].sort((a, b) =>
    starredSort === "desc"
      ? b.timestamp.localeCompare(a.timestamp)
      : a.timestamp.localeCompare(b.timestamp),
  );

  const handleStarFromStarredTab = async (id: number, starred: boolean) => {
    // Optimistically drop the idea from the starred list on unstar, then fall
    // through to the shared starIdea which updates the main feed cache.
    if (!starred) {
      void mutateStarred(
        (current) => ({ ideas: (current?.ideas ?? []).filter(i => i.id !== id) }),
        { revalidate: false },
      );
    }
    await starIdea(id, starred);
  };

  // Fetch profile when settings opens
  useEffect(() => {
    if (settingsOpen) {
      fetchProfile()
        .then((p) => setAvatarUrl(p.avatar_url))
        .catch(() => {});
    }
  }, [settingsOpen]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setAvatarUrl(localUrl);
    try {
      const result = await uploadAvatar(file);
      setAvatarUrl(result.avatar_url);
    } catch {
      toast.error("Failed to upload avatar");
      setAvatarUrl(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        onStatsClick={() => setStatsOpen(true)}
        onMoodClick={() => setMoodOpen(true)}
        ideaCount={ideas.length}
      />

      <main className="px-4 pt-2 max-w-lg mx-auto">
        {activeTab === "ideas" && (
          <IdeaFeed
            ideas={ideas}
            isLoading={isLoading}
            onRefresh={() => mutate()}
            onStar={starIdea}
            onLoadMore={loadMore}
            hasMore={hasMore}
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

        {activeTab === "feed" && <FeedView />}

        {activeTab === "starred" && (
          <div className="pt-2 space-y-4">
            {starredIdeas.length === 0 && starredFeedPosts.length === 0 ? (
              <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>
                <p className="text-sm">No starred ideas yet.</p>
                <p className="text-xs mt-1">Tap the star on any idea or feed post to save it here.</p>
              </div>
            ) : (
              <>
                {starredIdeas.length > 1 && (
                  <div
                    className="flex rounded-xl p-0.5"
                    style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <button
                      onClick={() => setStarredSort("desc")}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{
                        backgroundColor: starredSort === "desc" ? "var(--foreground)" : "transparent",
                        color: starredSort === "desc" ? "var(--background)" : "var(--muted-foreground)",
                      }}
                    >
                      Newest first
                    </button>
                    <button
                      onClick={() => setStarredSort("asc")}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{
                        backgroundColor: starredSort === "asc" ? "var(--foreground)" : "transparent",
                        color: starredSort === "asc" ? "var(--background)" : "var(--muted-foreground)",
                      }}
                    >
                      Oldest first
                    </button>
                  </div>
                )}
                {starredIdeas.length > 0 && (
                  <div className="space-y-2">
                    {starredIdeas.map(idea => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        onStar={(starred) => handleStarFromStarredTab(idea.id, starred)}
                      />
                    ))}
                  </div>
                )}
                {starredFeedPosts.length > 0 && (
                  <div className="space-y-3">
                    {starredIdeas.length > 0 && (
                      <p className="text-[11px] font-semibold uppercase tracking-wider px-1"
                        style={{ color: "var(--muted-foreground)" }}>
                        Saved from feed
                      </p>
                    )}
                    {starredFeedPosts.map(post => (
                      <FeedPostCard
                        key={post.id}
                        post={post}
                        onUnstar={() => unstarPost(post.idea_id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "summaries" && <SummariesView />}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} onAdd={() => setCaptureOpen(true)} />

      <MoodSheet open={moodOpen} onOpenChange={setMoodOpen} />

      <CaptureSheet
        open={captureOpen}
        onOpenChange={(v) => {
          setCaptureOpen(v);
          if (!v) setAutoRecord(false);
        }}
        onAdd={addIdea}
        onSketchOpen={() => {
          setCaptureOpen(false);
          setSketchOpen(true);
        }}
        sketchBlob={sketchBlob}
        clearSketch={() => setSketchBlob(null)}
        autoRecord={autoRecord}
        onAutoRecordConsumed={() => setAutoRecord(false)}
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

      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "var(--foreground)" }}>Stats</DialogTitle>
          </DialogHeader>
          <div className="pt-1">
            <StatsView ideas={ideas} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--foreground)" }}>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-1">
            {/* Profile */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="relative active:opacity-70 transition-opacity"
              >
                <AvatarCircle username={username} avatarUrl={avatarUrl} size={72} />
                <div
                  className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
                >
                  <span className="text-white text-xs font-medium">Edit</span>
                </div>
              </button>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{username}</p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Tap to change photo</p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>

            {/* Face ID */}
            <BiometricToggle />

            {/* Theme */}
            <div>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
                Theme
              </p>
              <ThemeSelector />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
