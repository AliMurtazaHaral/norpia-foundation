import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getContextConfig } from "@/backend/ai/context-config";
import {
  contentSimilarity,
  findSimilarMemory,
  parseCandidates,
  planMemoryChanges,
  shouldExtractMemories,
  type MemoryCandidate,
} from "@/backend/memory/memory-extraction";
import type { UserMemory } from "@/backend/memory/memory-types";

const migration = readFileSync("infrastructure/db/migrations/0008_memory_extraction.sql", "utf8");
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
    content: "User's company is ABC Technologies",
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

describe("candidate parsing", () => {
  it("reads JSON even when the model wraps it in fences or prose", () => {
    const parsed = parseCandidates(
      '```json\n{"memories":[{"content":"User prefers concise responses","category":"preference","importance":4,"confidence":0.9}]}\n```',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.category).toBe("preference");
  });

  it("returns nothing for malformed or empty answers", () => {
    expect(parseCandidates("I could not find anything.")).toEqual([]);
    expect(parseCandidates('{"memories":[]}')).toEqual([]);
    expect(parseCandidates('{"memories":[{"content":""}]}')).toEqual([]);
  });
});

describe("memory quality filtering", () => {
  it("stores durable, confident information", () => {
    const result = plan([candidate()]);
    expect(result.creates).toHaveLength(1);
  });

  it("drops low-confidence and unimportant statements", () => {
    const result = plan([
      candidate({ content: "User is tired today", importance: 1, confidence: 0.9 }),
      candidate({ content: "User might move to Berlin", confidence: 0.2 }),
    ]);
    expect(result.creates).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });

  it("caps the number of writes per run", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      candidate({ content: `User owns unrelated asset number ${i}` }),
    );
    const result = plan(many);
    expect(result.creates.length).toBeLessThanOrEqual(settings.maxPerRun);
    expect(result.skipped).toBeGreaterThan(0);
  });
});

describe("duplicate detection", () => {
  it("scores rephrased statements as similar", () => {
    expect(
      contentSimilarity("User prefers concise responses", "User prefers concise answers"),
    ).toBeGreaterThan(settings.duplicateThreshold);
    expect(
      contentSimilarity("User prefers concise responses", "User runs a hotel directory platform"),
    ).toBeLessThan(settings.duplicateThreshold);
  });

  it("does not create a second phrasing of an existing memory", () => {
    const existing = [memory({ content: "User prefers concise answers", importance: 4 })];
    const result = plan(
      [candidate({ content: "User likes short and direct responses", importance: 3 })],
      existing,
    );
    expect(result.creates).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("lifts importance when the new signal is stronger, keeping the stored wording", () => {
    const existing = [memory({ content: "User prefers concise answers", importance: 2 })];
    const result = plan(
      [candidate({ content: "User always wants concise answers", importance: 5 })],
      existing,
    );
    expect(result.creates).toHaveLength(0);
    expect(result.updates[0]!.candidate.content).toBe("User prefers concise answers");
    expect(result.updates[0]!.candidate.importance).toBe(5);
  });

  it("finds the closest existing memory only above the threshold", () => {
    const existing = [memory({ content: "User works on Project Atlas" })];
    expect(findSimilarMemory("User works on Project Atlas", existing, 0.45)).not.toBeNull();
    expect(findSimilarMemory("User enjoys sailing", existing, 0.45)).toBeNull();
  });
});

describe("memory updates", () => {
  it("replaces an outdated memory instead of accumulating contradictions", () => {
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

  it("treats unrelated new information as a new memory", () => {
    const existing = [memory({ content: "User prefers concise answers" })];
    const result = plan([candidate({ content: "User runs a hotel directory platform" })], existing);
    expect(result.creates).toHaveLength(1);
  });
});

describe("extraction trigger", () => {
  it("never runs after every message and respects the switch", () => {
    expect(settings.triggerMessages).toBeGreaterThan(1);
    expect(shouldExtractMemories({ unanalysedMessages: 1, config })).toBe(false);
    expect(
      shouldExtractMemories({ unanalysedMessages: settings.triggerMessages, config }),
    ).toBe(true);
    const off = {
      ...config,
      memory: { ...config.memory, extraction: { ...settings, enabled: false } },
    };
    expect(shouldExtractMemories({ unanalysedMessages: 50, config: off })).toBe(false);
  });
});

describe("extraction database changes", () => {
  it("adds confidence and an extraction bookmark without widening access", () => {
    expect(migration).toContain("add column if not exists confidence");
    expect(migration).toContain("memory_extracted_through");
    expect(migration).not.toContain("to anon");
    expect(migration).not.toMatch(/drop policy/i);
  });
});
