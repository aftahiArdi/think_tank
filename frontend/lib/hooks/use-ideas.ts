import useSWR from "swr";
import { fetchIdeas, createIdea, deleteIdea, updateIdea, starIdea as apiStarIdea } from "@/lib/api";
import type { Idea } from "@/lib/types";

export function useIdeas() {
  const { data, error, isLoading, mutate } = useSWR("ideas", () => fetchIdeas());

  const ideas = data?.ideas ?? [];

  const addIdea = async (content: string, categoryId?: number) => {
    const tempId = -Date.now();
    const optimistic: Idea = {
      id: tempId,
      content,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      media_type: "text",
      has_media: false,
      starred: false,
      category: null,
      media: [],
    };

    mutate(
      async () => {
        const result = await createIdea(content, categoryId);
        return fetchIdeas();
      },
      {
        optimisticData: { ideas: [optimistic, ...ideas], total: ideas.length + 1 },
        rollbackOnError: true,
      }
    );
  };

  const removeIdea = async (id: number) => {
    mutate(
      async () => {
        await deleteIdea(id);
        return fetchIdeas();
      },
      {
        optimisticData: {
          ideas: ideas.filter((i) => i.id !== id),
          total: ideas.length - 1,
        },
        rollbackOnError: true,
      }
    );
  };

  const patchIdea = async (id: number, data: { content?: string; category_id?: number }) => {
    await updateIdea(id, data);
    mutate();
  };

  const starIdea = async (id: number, starred: boolean) => {
    const optimistic = ideas.map(i => i.id === id ? { ...i, starred } : i);
    mutate(
      async () => {
        await apiStarIdea(id, starred);
        return { ideas: optimistic, total: ideas.length };
      },
      {
        optimisticData: { ideas: optimistic, total: ideas.length },
        rollbackOnError: true,
      }
    );
  };

  return { ideas, isLoading, error, mutate, addIdea, removeIdea, patchIdea, starIdea };
}
