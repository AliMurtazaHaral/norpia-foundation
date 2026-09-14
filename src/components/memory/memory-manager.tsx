/**
 * Small review surface for JARVIS long-term memory (Month 2 — Week 2).
 * Add, deactivate, reactivate and delete memories. All logic lives in the
 * backend memory service; this component only talks to the memory client.
 */

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_LABELS,
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
  type MemoryCategory,
  type UserMemory,
} from "@/lib/memory/memory-api";

export function MemoryManager() {
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("preference");

  async function refresh() {
    try {
      setMemories(await listMemories({ status: "all" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Memories could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createMemory({ content: content.trim(), category });
      setContent("");
      await refresh();
      toast.success("Memory saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That memory could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(memory: UserMemory) {
    try {
      await updateMemory(memory.id, { is_active: !memory.is_active });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That memory could not be updated.");
    }
  }

  async function onDelete(memory: UserMemory) {
    try {
      await deleteMemory(memory.id);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That memory could not be deleted.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">What JARVIS remembers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Long-term notes about you that stay available across conversations. Inactive notes are
          never sent to JARVIS.
        </p>

        <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px_auto]">
          <div className="space-y-1">
            <Label htmlFor="memory-content">Memory</Label>
            <Input
              id="memory-content"
              value={content}
              maxLength={2000}
              placeholder="I prefer concise answers in British English."
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="memory-category">Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as MemoryCategory)}>
              <SelectTrigger id="memory-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MEMORY_CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !content.trim()}>
              {saving ? "Saving…" : "Add memory"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading memories…</p>
        ) : memories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No memories yet. Add one above and JARVIS will keep it in mind.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {memories.map((memory) => (
              <li key={memory.id} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      memory.is_active
                        ? "text-sm text-foreground"
                        : "text-sm text-muted-foreground line-through"
                    }
                  >
                    {memory.content}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary">{MEMORY_CATEGORY_LABELS[memory.category]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Importance {memory.importance}/5
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => void onToggle(memory)}>
                    {memory.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void onDelete(memory)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
