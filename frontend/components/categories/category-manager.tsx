"use client";

import { useState } from "react";
import { useCategories } from "@/lib/hooks/use-categories";
import { useIdeas } from "@/lib/hooks/use-ideas";
import { createCategory, deleteCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function CategoryManager() {
  const { categories, mutate } = useCategories();
  const { ideas } = useIdeas();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#71717a");

  const getIdeaCount = (catId: number) =>
    ideas.filter((i) => i.category?.id === catId).length;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await createCategory(newName, newColor);
      setNewName("");
      mutate();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create category");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (name === "Misc") return;
    try {
      await deleteCategory(id);
      mutate();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete category");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between p-3 rounded-xl"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-sm" style={{ color: "var(--foreground)" }}>
                {cat.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {getIdeaCount(cat.id)}
              </span>
              {cat.name !== "Misc" && (
                <button onClick={() => handleDelete(cat.id, cat.name)}>
                  <Trash2 size={14} style={{ color: "var(--muted-foreground)" }} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add new category */}
      <div className="flex gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer border-0"
        />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="flex-1"
        />
        <Button onClick={handleAdd} size="icon">
          <Plus size={16} />
        </Button>
      </div>
    </div>
  );
}
