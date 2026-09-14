import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getContextConfig } from "@/backend/ai/context-config";
import {
  memoryContextBlocks,
  retrieveRelevantMemories,
  scoreMemory,
} from "@/backend/memory/memory-service";
import {
  MEMORY_CATEGORIES,
  createMemorySchema,
  listMemoriesSchema,
  updateMemorySchema,
  type UserMemory,
} from "@/backend/memory/memory-types";

const migration = readFileSync("infrastructure/db/migrations/0007_user_memories.sql", "utf8");

function memory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: crypto.randomUUID(),
    user_id: "user-a",
    content: "Prefers concise answers about invoicing",
    category: "preference",
    importance: 3,
    source: "user",
    source_conversation_id: null,
    is_active: true,
    metadata: {},
    last_used_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Stub matching the calls retrieveRelevantMemories makes. */
function stubSupabase(rows: UserMemory[], captured: Record<string, unknown> = {}) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      captured[column] = value;
      return builder;
    },
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
    update: () => builder,
  });
  return { from: () => builder } as never;
}

describe("memory model", () => {
  it("keeps a small, extensible category set", () => {
    expect(MEMORY_CATEGORIES).toContain("preference");
    expect(MEMORY_CATEGORIES).toContain("business");
    expect(MEMORY_CATEGORIES.length).toBeLessThanOrEqual(12);
  });

  it("validates create input and rejects empty content", () => {
    expect(createMemorySchema.parse({ content: "Runs a logistics company" }).category).toBe("other");
    expect(createMemorySchema.safeParse({ content: "   " }).success).toBe(false);
    expect(createMemorySchema.safeParse({ content: "x".repeat(2001) }).success).toBe(false);
  });

  it("requires at least one field on update and defaults list status to active", () => {
    expect(updateMemorySchema.safeParse({}).success).toBe(false);
    expect(updateMemorySchema.safeParse({ is_active: false }).success).toBe(true);
    expect(listMemoriesSchema.parse({}).status).toBe("active");
  });
});

describe("memory retrieval", () => {
  it("ranks by importance, keyword overlap and recency", () => {
    const tokens = ["invoicing"];
    const relevant = scoreMemory(memory(), tokens);
    const irrelevant = scoreMemory(memory({ content: "Likes hiking" }), tokens);
    expect(relevant).toBeGreaterThan(irrelevant);
    expect(scoreMemory(memory({ importance: 5 }), [])).toBeGreaterThan(
      scoreMemory(memory({ importance: 1 }), []),
    );
  });

  it("only requests the caller's active memories", async () => {
    const captured: Record<string, unknown> = {};
    await retrieveRelevantMemories(stubSupabase([memory()], captured), "user-a", {
      maxMemories: 5,
      maxCharacters: 500,
    });
    expect(captured["user_id"]).toBe("user-a");
    expect(captured["is_active"]).toBe(true);
  });

  it("respects the item and character budgets", async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      memory({ content: `Fact number ${index} `.repeat(10) }),
    );
    const selected = await retrieveRelevantMemories(stubSupabase(rows), "user-a", {
      maxMemories: 3,
      maxCharacters: 400,
    });
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(400);
  });

  it("renders one labelled system block, or nothing when empty", () => {
    expect(memoryContextBlocks([])).toEqual([]);
    const [block] = memoryContextBlocks([memory()]);
    expect(block).toContain("Long-term memory");
    expect(block).toContain("Preferences");
  });
});

describe("memory security", () => {
  it("is configurable and enabled by default", () => {
    const config = getContextConfig();
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.maxMemories).toBeGreaterThan(0);
    expect(config.future.retrievalEnabled).toBe(false);
  });

  it("isolates memories per user in the database", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toMatch(/using \(auth\.uid\(\) = user_id\)/);
    expect(migration).toMatch(/with check \(\s*auth\.uid\(\) = user_id/);
    expect(migration).toContain("grant select, insert, update, delete on public.user_memories to authenticated");
  });

  it("never grants anon access to memories", () => {
    expect(migration).not.toContain("to anon");
  });
});
