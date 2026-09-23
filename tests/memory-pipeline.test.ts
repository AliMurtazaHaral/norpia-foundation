/**
 * Month 2 — Week 2 fix: the cross-conversation memory pipeline.
 *
 * Reproduces the reported bug end to end at service level:
 *   Conversation 1: "Remember that my company is based in Switzerland."
 *   Conversation 2 (new): "What do you know about my company?"
 * and asserts the memory is persisted for the user and retrieved again.
 */

import { describe, expect, it } from "vitest";

import { getContextConfig } from "@/backend/ai/context-config";
import {
  detectExplicitMemoryRequest,
  extractMemoriesFromConversation,
  shouldExtractMemories,
} from "@/backend/memory/memory-extraction";
import {
  memoryContextBlocks,
  retrieveRelevantMemories,
} from "@/backend/memory/memory-service";
import type { UserMemory } from "@/backend/memory/memory-types";

const config = getContextConfig();

function memory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: crypto.randomUUID(),
    user_id: "user-a",
    content: "User's company is based in Switzerland",
    category: "business",
    importance: 4,
    confidence: 0.9,
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

/** Minimal Supabase stub: records writes, serves reads, honours user/active filters. */
function stubDb(options: { memories?: UserMemory[]; messages?: unknown[]; failRead?: boolean } = {}) {
  const store = {
    memories: [...(options.memories ?? [])],
    inserted: [] as Array<Record<string, unknown>>,
    bookmarkUpdates: 0,
  };

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        gt: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => {
          const promise = resolveRead() as Promise<unknown> & { returns?: () => unknown };
          promise.returns = () => promise;
          return promise;
        },
        returns: () => builder,
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          const saved = list.map((row) => ({
            ...memory(row as Partial<UserMemory>),
            id: crypto.randomUUID(),
          }));
          store.inserted.push(...list);
          store.memories.push(...saved);
          return {
            select: () => Promise.resolve({ data: saved.map((r) => ({ id: r.id, category: r.category })), error: null }),
          };
        },
        update: () => {
          if (table === "conversations") store.bookmarkUpdates += 1;
          return { eq: () => builder, in: () => builder, then: undefined };
        },
        then: undefined,
      };

      function resolveRead() {
        if (options.failRead) return Promise.resolve({ data: null, error: { message: "db down" } });
        if (table === "messages") return Promise.resolve({ data: options.messages ?? [], error: null });
        const rows = store.memories.filter(
          (row) =>
            (filters["user_id"] === undefined || row.user_id === filters["user_id"]) &&
            (filters["is_active"] === undefined || row.is_active === filters["is_active"]),
        );
        return Promise.resolve({ data: rows, error: null });
      }

      // Reads that end on .eq()/.in() rather than .limit() still resolve.
      (builder as { eq: unknown }).eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      return builder;
    },
  } as never;

  return { client, store };
}

/** Extraction provider stub: returns one durable business memory. */
const provider = {
  id: "stub",
  async *streamChat() {
    yield {
      delta:
        '{"memories":[{"content":"User\'s company is based in Switzerland","category":"business","importance":4,"confidence":0.95,"replaces":null}]}',
    };
  },
} as never;

describe("explicit memory requests", () => {
  it("recognises direct instructions to remember something", () => {
    expect(detectExplicitMemoryRequest("Remember that my company is based in Switzerland.")).toBe(true);
    expect(detectExplicitMemoryRequest("Merk dir bitte meine Firma.")).toBe(true);
    expect(detectExplicitMemoryRequest("From now on answer in German.")).toBe(true);
    expect(detectExplicitMemoryRequest("What is the weather today?")).toBe(false);
  });

  it("bypasses the message threshold only for explicit requests", () => {
    // This was the root cause: a two-message conversation never reached the
    // default trigger, so nothing was ever extracted.
    expect(shouldExtractMemories({ unanalysedMessages: 2, config })).toBe(false);
    expect(shouldExtractMemories({ unanalysedMessages: 2, config, explicitRequest: true })).toBe(true);
    expect(shouldExtractMemories({ unanalysedMessages: 0, config, explicitRequest: true })).toBe(false);
  });
});

describe("conversation 1 — persistence", () => {
  it("writes a user-owned memory and reports the saved ids", async () => {
    const { client, store } = stubDb({
      messages: [
        { role: "user", content: "Remember that my company is based in Switzerland.", created_at: "2026-01-01T10:00:00Z" },
        { role: "assistant", content: "Noted.", created_at: "2026-01-01T10:00:01Z" },
      ],
    });

    const result = await extractMemoriesFromConversation({
      supabase: client,
      provider,
      config,
      conversationId: crypto.randomUUID(),
      userId: "user-a",
      explicitRequest: true,
    });

    expect(result.created).toBe(1);
    expect(result.createdIds).toHaveLength(1);
    expect(result.persistenceFailed).toBe(false);
    const saved = store.inserted[0] as Record<string, unknown>;
    expect(saved["user_id"]).toBe("user-a");
    expect(saved["category"]).toBe("business");
    // Ownership is the user, never the conversation.
    expect(saved["source_conversation_id"]).toBeTypeOf("string");
    expect(store.bookmarkUpdates).toBeGreaterThan(0);
  });
});

describe("conversation 2 — retrieval in a brand new conversation", () => {
  it("returns the stored company memory for the same user", async () => {
    const { client } = stubDb({ memories: [memory()] });
    const selected = await retrieveRelevantMemories(client, "user-a", {
      query: "What do you know about my company?",
      maxMemories: config.memory.maxMemories,
      maxCharacters: config.memory.maxCharacters,
      minRelevanceScore: config.memory.minRelevanceScore,
      alwaysIncludeImportance: config.memory.alwaysIncludeImportance,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]!.content).toContain("Switzerland");
    const [block] = memoryContextBlocks(selected);
    expect(block).toContain("Switzerland");
  });

  it("never returns another user's memory", async () => {
    const { client } = stubDb({ memories: [memory({ user_id: "user-b" })] });
    const selected = await retrieveRelevantMemories(client, "user-a", {
      query: "What do you know about my company?",
      maxMemories: 5,
      maxCharacters: 2000,
    });
    expect(selected).toHaveLength(0);
  });

  it("excludes deactivated memories", async () => {
    const { client } = stubDb({ memories: [memory({ is_active: false })] });
    const selected = await retrieveRelevantMemories(client, "user-a", {
      query: "What do you know about my company?",
      maxMemories: 5,
      maxCharacters: 2000,
    });
    expect(selected).toHaveLength(0);
  });

  it("handles an empty memory store and a failing database", async () => {
    const empty = stubDb({ memories: [] });
    await expect(
      retrieveRelevantMemories(empty.client, "user-a", { maxMemories: 5, maxCharacters: 2000 }),
    ).resolves.toEqual([]);

    const broken = stubDb({ failRead: true });
    await expect(
      retrieveRelevantMemories(broken.client, "user-a", { maxMemories: 5, maxCharacters: 2000 }),
    ).rejects.toThrow();
  });
});
