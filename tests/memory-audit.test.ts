/**
 * Month 2 — Week 2 (Prompt 3): audit suite for the long-term memory system.
 * Covers memory quality, duplicates, contradictions, retrieval relevance,
 * context priority, user controls and database/security guarantees.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getContextConfig } from "@/backend/ai/context-config";
import {
  planMemoryChanges,
  type MemoryCandidate,
} from "@/backend/memory/memory-extraction";
import {
  memoryContextBlocks,
  retrieveRelevantMemories,
  scoreMemory,
} from "@/backend/memory/memory-service";
import type { UserMemory } from "@/backend/memory/memory-types";

const migration = readFileSync("infrastructure/db/migrations/0009_memory_hardening.sql", "utf8");
const config = getContextConfig();
const settings = config.memory.extraction;

function memory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: crypto.randomUUID(),
    user_id: "user-a",
    content: "User prefers concise answers",
    category: "preference",
    importance: 3,
    confidence: 0.9,
    source: "assistant",
    source_conversation_id: null,
    is_active: true,
    metadata: {},
    last_used_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    content: "User's company is XYZ",
    category: "business",
    importance: 4,
    confidence: 0.9,
    replaces: null,
    ...overrides,
  };
}

function plan(candidates: MemoryCandidate[], existing: UserMemory[] = []) {
  return planMemoryChanges({
    candidates,
    existing,
    minConfidence: settings.minConfidence,
    minImportance: settings.minImportance,
    duplicateThreshold: settings.duplicateThreshold,
    maxPerRun: settings.maxPerRun,
  });
}

/** Minimal stand-in for the query builder retrieveRelevantMemories uses. */
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

function retrieve(rows: UserMemory[], query?: string) {
  return retrieveRelevantMemories(stubSupabase(rows), "user-a", {
    maxMemories: config.memory.maxMemories,
    maxCharacters: config.memory.maxCharacters,
    minRelevanceScore: config.memory.minRelevanceScore,
    alwaysIncludeImportance: config.memory.alwaysIncludeImportance,
    ...(query ? { query } : {}),
  });
}

/* ------------------------------------------------- 1. memory quality audit */

describe("memory quality audit", () => {
  it("keeps durable user information", () => {
    const result = plan([
      candidate({ content: "User's company is called XYZ", category: "business", importance: 4 }),
      candidate({
        content: "User always prefers concise answers",
        category: "preference",
        importance: 5,
      }),
      candidate({
        content: "User is building NORPIA for European businesses",
        category: "project",
        importance: 4,
      }),
    ]);
    expect(result.creates).toHaveLength(3);
  });

  it("drops one-off and temporary conversation details", () => {
    // Temporary asks arrive as low-importance candidates; the filter removes them.
    const result = plan([
      candidate({ content: "User needs a logo for this project", importance: 1, confidence: 0.9 }),
      candidate({ content: "User needs a proposal today", importance: 1, confidence: 0.9 }),
      candidate({ content: "User may relocate at some point", importance: 4, confidence: 0.3 }),
    ]);
    expect(result.creates).toHaveLength(0);
    expect(result.skipped).toBe(3);
  });
});

/* ----------------------------------------------- 2/3. duplicates & conflict */

describe("duplicate and contradiction audit", () => {
  it("does not store a second phrasing of an existing memory", () => {
    const existing = [memory({ content: "User's company is called XYZ", category: "business" })];
    const result = plan(
      [candidate({ content: "User works at the company XYZ", importance: 3 })],
      existing,
    );
    expect(result.creates).toHaveLength(0);
  });

  it("replaces an outdated project instead of keeping both", () => {
    const existing = [memory({ content: "User is working on Project A", category: "project" })];
    const result = plan(
      [
        candidate({
          content: "User is working on Project B",
          category: "project",
          replaces: "User is working on Project A",
        }),
      ],
      existing,
    );
    expect(result.creates).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.id).toBe(existing[0]!.id);
    expect(result.updates[0]!.candidate.content).toBe("User is working on Project B");
  });
});

/* -------------------------------------------------- 4. retrieval relevance */

describe("retrieval relevance audit", () => {
  it("injects a memory related to the current question", async () => {
    const rows = [memory({ content: "User's invoicing runs on monthly cycles", importance: 3 })];
    expect(await retrieve(rows, "How should I handle invoicing this month?")).toHaveLength(1);
  });

  it("leaves unrelated low-importance memories out of the context", async () => {
    const rows = [memory({ content: "User enjoys sailing on weekends", importance: 2 })];
    expect(await retrieve(rows, "Draft an invoice reminder email")).toHaveLength(0);
  });

  it("always keeps standing rules, even for an unrelated question", async () => {
    const rows = [memory({ content: "User always wants answers in British English", importance: 5 })];
    expect(await retrieve(rows, "Draft an invoice reminder email")).toHaveLength(1);
  });

  it("returns nothing when the user has no memories", async () => {
    expect(await retrieve([], "Anything relevant?")).toEqual([]);
  });

  it("stays bounded with a large memory store", async () => {
    const rows = Array.from({ length: 300 }, (_, index) =>
      memory({ content: `User tracks supplier number ${index} for invoicing`, importance: 3 }),
    );
    const selected = await retrieve(rows, "invoicing supplier update");
    expect(selected.length).toBeLessThanOrEqual(config.memory.maxMemories);
    expect(selected.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(
      config.memory.maxCharacters,
    );
  });

  it("only ever asks for the caller's own active memories", async () => {
    const captured: Record<string, unknown> = {};
    await retrieveRelevantMemories(stubSupabase([memory()], captured), "user-a", {
      maxMemories: 5,
      maxCharacters: 500,
    });
    expect(captured["user_id"]).toBe("user-a");
    expect(captured["is_active"]).toBe(true);
  });
});

/* ----------------------------------------------------- 5. context priority */

describe("context priority", () => {
  it("tells the model the current conversation outranks a stored note", () => {
    const [block] = memoryContextBlocks([memory()]);
    expect(block).toContain("the current conversation wins");
    expect(block).toContain("Long-term memory");
  });

  it("ranks confident, important memories above weak ones", () => {
    expect(scoreMemory(memory({ importance: 5, confidence: 1 }), [])).toBeGreaterThan(
      scoreMemory(memory({ importance: 2, confidence: 0.3 }), []),
    );
  });
});

/* ------------------------------------------- 6/7. controls, database, RLS */

describe("memory hardening migration", () => {
  it("stops usage bookkeeping from faking a recent edit", () => {
    expect(migration).toContain("new.updated_at := old.updated_at");
    expect(migration).toContain("last_used_at is distinct from old.last_used_at");
  });

  it("keeps ownership immutable and grants no anonymous access", () => {
    expect(migration).toContain("new.user_id    := old.user_id");
    expect(migration).not.toContain("to anon");
    expect(migration).not.toMatch(/drop policy/i);
  });
});
