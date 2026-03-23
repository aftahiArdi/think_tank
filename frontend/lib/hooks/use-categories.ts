import useSWR from "swr";
import { fetchCategories } from "@/lib/api";

export function useCategories() {
  const { data, error, isLoading, mutate } = useSWR("categories", () => fetchCategories());

  return {
    categories: data?.categories ?? [],
    isLoading,
    error,
    mutate,
  };
}
