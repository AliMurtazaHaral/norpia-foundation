/**
 * Frontend memory client.
 *
 * The UI never touches the `user_memories` table directly: it calls the
 * /api/v1/memories endpoints with the signed-in user's access token, and the
 * server enforces ownership through RLS.
 */

import { apiFetch } from "@/lib/api/client";
import { supabase } from "@/lib/supabase/client";
import type {
  MemoryCategory,
  MemorySource,
  UserMemory,
} from "@/backend/memory/memory-types";

export type { MemoryCategory, MemorySource, UserMemory };
export {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_LABELS,
  MEMORY_MAX_CONTENT_LENGTH,
} from "@/backend/memory/memory-types";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

export async function listMemories(
  params: { status?: "active" | "inactive" | "all"; category?: MemoryCategory } = {},
): Promise<UserMemory[]> {
  const search = new URLSearchParams();
  search.set("status", params.status ?? "active");
  if (params.category) search.set("category", params.category);
  const result = await apiFetch<{ items: UserMemory[] }>(`/memories?${search.toString()}`, {
    headers: await authHeaders(),
  });
  return result.items;
}

export async function createMemory(input: {
  content: string;
  category: MemoryCategory;
  importance?: number;
}): Promise<UserMemory> {
  return apiFetch<UserMemory>("/memories", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      content: input.content,
      category: input.category,
      importance: input.importance ?? 3,
      source: "user",
    }),
  });
}

export async function updateMemory(
  id: string,
  input: { content?: string; category?: MemoryCategory; importance?: number; is_active?: boolean },
): Promise<UserMemory> {
  return apiFetch<UserMemory>(`/memories/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await apiFetch<{ id: string }>(`/memories/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
}
