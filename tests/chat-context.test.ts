import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildChatContext, estimateTokens, type StoredTurn } from "@/backend/ai/context-manager";
import { getAiModelConfig, getSystemPrompt, PROMPT_VERSIONS } from "@/backend/ai/jarvis-prompt";

const route = readFileSync("src/routes/api/v1/ai/chat.ts", "utf8");
const indexes = readFileSync("infrastructure/db/migrations/0005_chat_performance.sql", "utf8");

const config = getAiModelConfig();

function turns(count: number, size = 10): StoredTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${i}`.padEnd(size, "x"),
  }));
}

describe("context management", () => {
  it("always leads with the versioned system prompt", () => {
    const { messages } = buildChatContext({ history: turns(3), config });
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(getSystemPrompt(config.promptVersion));
  });

  it("keeps only the most recent messages within the limit", () => {
    const { messages, stats } = buildChatContext({
      history: turns(config.maxHistoryMessages + 10),
      config,
    });
    expect(stats.historyMessages).toBeLessThanOrEqual(config.maxHistoryMessages);
    expect(messages.at(-1)?.content).toContain(String(config.maxHistoryMessages + 9));
  });

  it("enforces a character budget, newest turns first", () => {
    const tight = { ...config, maxContextCharacters: 25 };
    const { stats } = buildChatContext({ history: turns(10), config: tight });
    expect(stats.contextCharacters).toBeLessThanOrEqual(25);
    expect(stats.droppedMessages).toBeGreaterThan(0);
  });

  it("never drops the latest message even when oversized", () => {
    const tight = { ...config, maxContextCharacters: 5 };
    const { stats } = buildChatContext({
      history: [{ role: "user", content: "x".repeat(500) }],
      config: tight,
    });
    expect(stats.historyMessages).toBe(1);
  });

  it("injects future memory blocks after the system prompt", () => {
    const { messages } = buildChatContext({
      history: turns(2),
      config,
      memoryBlocks: ["Known fact: the company is called NORPIA."],
    });
    expect(messages[1]?.role).toBe("system");
    expect(messages[1]?.content).toContain("NORPIA");
  });

  it("estimates tokens for usage logging", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });
});

describe("prompt registry", () => {
  it("is versioned and configurable", () => {
    expect(Object.keys(PROMPT_VERSIONS).length).toBeGreaterThan(0);
    expect(getSystemPrompt("v1")).toMatch(/conversation history/i);
  });

  it("ties capability claims to real integrations", () => {
    expect(getSystemPrompt("v1")).toMatch(/integration or tool is actually\s+connected/);
  });
});

describe("cost control configuration", () => {
  it("exposes MAX_CONTEXT_MESSAGES and MAX_OUTPUT_TOKENS", () => {
    const source = readFileSync("src/backend/ai/jarvis-prompt.ts", "utf8");
    expect(source).toContain("MAX_CONTEXT_MESSAGES");
    expect(source).toContain("MAX_OUTPUT_TOKENS");
    expect(config.maxOutputTokens).toBeGreaterThan(0);
    expect(config.maxHistoryMessages).toBeGreaterThan(0);
  });
});

describe("chat route reliability", () => {
  it("deduplicates repeated user submissions and retries", () => {
    expect(route).toContain("isDuplicate");
    expect(route).toContain("DUPLICATE_WINDOW_MS");
  });

  it("uses the shared context manager, not an inline window", () => {
    expect(route).toContain("buildChatContext");
  });

  it("logs usage without message content", () => {
    const log = readFileSync("src/backend/ai/usage-log.ts", "utf8");
    expect(route).toContain("logAiUsage");
    expect(log).not.toMatch(/record\.content|apiKey|OPENAI_API_KEY/);
  });
});

describe("database performance", () => {
  it("indexes both hot query paths and nothing else", () => {
    expect(indexes).toMatch(/idx_conversations_user_updated[\s\S]*user_id, updated_at desc/);
    expect(indexes).toMatch(/idx_messages_conversation_created[\s\S]*conversation_id, created_at/);
    expect(indexes).toMatch(/drop index if exists public\.idx_messages_user/);
  });
});
