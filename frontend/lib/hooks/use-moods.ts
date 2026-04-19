"use client";

import useSWR from "swr";
import { fetchMoods, logMood as logMoodApi, deleteMood as deleteMoodApi } from "@/lib/api";
import type { MoodHistory } from "@/lib/types";

const CACHE_KEY = (days: number) => `moods-${days}`;

export function useMoods(days: number = 30) {
  const { data, isLoading, mutate } = useSWR<MoodHistory>(
    CACHE_KEY(days),
    () => fetchMoods(days),
  );

  async function logMood(value: number) {
    const mood = await logMoodApi(value);
    await mutate();
    return mood;
  }

  async function removeMood(id: number) {
    await deleteMoodApi(id);
    await mutate();
  }

  return {
    data,
    isLoading,
    logMood,
    removeMood,
    refresh: mutate,
  };
}
