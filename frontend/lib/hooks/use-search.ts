import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import { searchIdeas } from "@/lib/api";
import type { Idea, SearchResult } from "@/lib/types";

export function useSearch(ideas: Idea[]) {
  const [query, setQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
  const [isSearchingDeep, setIsSearchingDeep] = useState(false);
  const [mode, setMode] = useState<"fuzzy" | "semantic">("fuzzy");

  const fuse = useMemo(
    () =>
      new Fuse(ideas, {
        keys: ["content"],
        threshold: 0.4,
        includeScore: true,
      }),
    [ideas]
  );

  const fuzzyResults = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query).map((r) => r.item);
  }, [fuse, query]);

  const triggerDeepSearch = async () => {
    if (!query.trim()) return;
    setIsSearchingDeep(true);
    setMode("semantic");
    try {
      const { results } = await searchIdeas(query);
      setSemanticResults(results);
    } catch (e) {
      console.error("Semantic search failed:", e);
    } finally {
      setIsSearchingDeep(false);
    }
  };

  const updateQuery = (q: string) => {
    setQuery(q);
    setMode("fuzzy");
    setSemanticResults([]);
  };

  return {
    query,
    setQuery: updateQuery,
    fuzzyResults,
    semanticResults,
    isSearchingDeep,
    mode,
    triggerDeepSearch,
  };
}
