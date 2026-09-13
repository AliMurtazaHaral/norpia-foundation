/**
 * Month 2 — Week 2: long-term memory model.
 *
 * A memory is a durable fact about the USER that stays useful across
 * conversations — distinct from a conversation summary, which describes one
 * conversation only. Categories are intentionally few and extensible: add an
 * entry here plus the matching value in the SQL check constraint.
 */

import { z } from "zod";

export const MEMORY_CATEGORIES = [
  "preference",
  "personal",
  "professional",
  "goal",
  "project",
  "fact",
  "instruction",
  "business",
  "other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preferences",
  personal: "Personal information",
  professional: "Professional information",
  goal: "Goals",
  project: "Projects",
  fact: "Important facts",
  instruction: "Instructions",
  business: "Business context",
  other: "Other",
};

export const MEMORY_SOURCES = ["user", "assistant", "system", "import"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface UserMemory {
  id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  source: MemorySource;
  source_conversation_id: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export const MEMORY_MAX_CONTENT_LENGTH = 2000;

export const createMemorySchema = z.object({
  content: z.string().trim().min(1).max(MEMORY_MAX_CONTENT_LENGTH),
  category: z.enum(MEMORY_CATEGORIES).default("other"),
  importance: z.number().int().min(1).max(5).default(3),
  source: z.enum(MEMORY_SOURCES).default("user"),
  source_conversation_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(MEMORY_MAX_CONTENT_LENGTH).optional(),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    importance: z.number().int().min(1).max(5).optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const listMemoriesSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES).optional(),
  /** "active" (default), "inactive" or "all". */
  status: z.enum(["active", "inactive", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;
