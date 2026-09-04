import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ChatProvider } from "@/backend/ai/chat-provider";
import { getContextConfig } from "@/backend/ai/context-config";
import {
  SUMMARY_PROMPT,
  shouldSummarize,
  summarizeConversation,
  summaryContextBlocks,
  SummarizationError,
  type ConversationSummary,
} from "@/backend/ai/conversation-summary";
import { prepareConversationContext } from "@/backend/ai/conversation-context";

const route = readFileSync("src/routes/api/v1/ai/chat.ts", "utf8");
const migration = readFileSync(
  "infrastructure/db/migrations/0006_conversation_summaries.sql",
  "utf8",
);

const config = getContextConfig();

function provider(text: string, fail = false): ChatProvider {
  return {
    id: "test",
    async *streamChat() {
      if (fail) throw new Error("upstream down");
      yield { delta: text };
    },
  };
}

/** Supabase stub: messages table + conversation_summaries upsert capture. */
function stubSupabase(options: {
  conversation?: { id: string; user_id: string } | null;
  messages?: Array<{ role: "user" | "assistant"; content: string; created_at: string }>;
  summary?: Record<string, unknown> | null;
  captured?: { row?: Record<string, unknown> };
  writeError?: boolean;
}) {
  return {
    from(table: string) {
      const rows = options.messages ?? [];
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain,
        eq: chain,
        gt: (_c: string, value: string) => {
          const filtered = rows.filter((r) => r.created_at > value);
          return {
            ...builder,
            order: () => ({
              limit: () => ({
                returns: () => Promise.resolve({ data: [...filtered].reverse(), error: null }),
              }),
            }),
          };
        },
        order: chain,
        limit: chain,
        returns: () =>
          Promise.resolve({
            data: table === "messages" ? rows : [],
            error: null,
          }),
        maybeSingle: async () => ({
          data:
            table === "conversations"
              ? (options.conversation ?? null)
              : (options.summary ?? null),
          error: null,
        }),
        upsert: async (row: Record<string, unknown>) => {
          if (options.captured) options.captured.row = row;
          return { error: options.writeError ? { message: "denied" } : null };
        },
      });
      if (table === "messages") {
        Object.assign(builder, {
          order: (_column: string, opts?: { ascending?: boolean }) => {
            const data = opts?.ascending ? rows : [...rows].reverse();
            const result = { returns: () => Promise.resolve({ data, error: null }) };
            return { ...result, limit: () => result };
          },
        });
      }

      return builder;
    },
  } as never;
}

function messages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `message ${i}`,
    created_at: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
}

describe("summary trigger", () => {
  it("does not summarise short conversations", () => {
    expect(shouldSummarize({ totalMessages: 4, summarizedMessages: 0, config })).toBe(false);
  });

  it("summarises once the conversation grows past the trigger", () => {
    expect(
      shouldSummarize({
        totalMessages: config.summary.triggerMessages + 1,
        summarizedMessages: 0,
        config,
      }),
    ).toBe(true);
  });

  it("does not re-summarise what is already covered", () => {
    expect(
      shouldSummarize({
        totalMessages: config.summary.triggerMessages + 2,
        summarizedMessages: config.summary.triggerMessages,
        config,
      }),
    ).toBe(false);
  });

  it("can be disabled entirely", () => {
    const off = { ...config, summary: { ...config.summary, enabled: false } };
    expect(shouldSummarize({ totalMessages: 999, summarizedMessages: 0, config: off })).toBe(false);
  });
});

describe("summary generation", () => {
  it("keeps the newest turns out of the summary and stores a version", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const rows = messages(30);
    const result = await summarizeConversation({
      supabase: stubSupabase({ messages: rows, captured }),
      provider: provider("- goal: ship NORPIA"),
      config,
      conversationId: "c1",
      userId: "u1",
    });

    expect(result?.summary).toContain("NORPIA");
    expect(result?.coveredMessageCount).toBe(30 - config.summary.keepRecentMessages);
    expect(captured.row?.["user_id"]).toBe("u1");
    expect(captured.row?.["version"]).toBe(1);
    expect(captured.row?.["covered_through"]).toBe(
      rows[30 - config.summary.keepRecentMessages - 1]!.created_at,
    );
  });

  it("returns null when there is nothing older to summarise", async () => {
    const result = await summarizeConversation({
      supabase: stubSupabase({ messages: messages(2) }),
      provider: provider("x"),
      config,
      conversationId: "c1",
      userId: "u1",
    });
    expect(result).toBeNull();
  });

  it("raises a safe error when the provider fails", async () => {
    await expect(
      summarizeConversation({
        supabase: stubSupabase({ messages: messages(30) }),
        provider: provider("", true),
        config,
        conversationId: "c1",
        userId: "u1",
      }),
    ).rejects.toBeInstanceOf(SummarizationError);
  });

  it("raises a safe error when the summary cannot be saved", async () => {
    await expect(
      summarizeConversation({
        supabase: stubSupabase({ messages: messages(30), writeError: true }),
        provider: provider("summary"),
        config,
        conversationId: "c1",
        userId: "u1",
      }),
    ).rejects.toBeInstanceOf(SummarizationError);
  });

  it("instructs the model to preserve decisions, goals and open questions", () => {
    expect(SUMMARY_PROMPT).toMatch(/decisions/i);
    expect(SUMMARY_PROMPT).toMatch(/goals/i);
    expect(SUMMARY_PROMPT).toMatch(/unresolved questions/i);
    expect(SUMMARY_PROMPT).toMatch(/never invent/i);
  });
});

describe("context builder layering", () => {
  it("renders the summary as a system block", () => {
    const summary: ConversationSummary = {
      summary: "- user runs NORPIA",
      coveredThrough: "2026-01-01T00:00:00.000Z",
      coveredMessageCount: 10,
      version: 2,
    };
    expect(summaryContextBlocks(summary)[0]).toContain("NORPIA");
    expect(summaryContextBlocks(null)).toEqual([]);
  });

  it("places summary before recent messages and avoids duplicating them", async () => {
    const rows = messages(20);
    const cutoff = rows[9]!.created_at;
    const prepared = await prepareConversationContext({
      supabase: stubSupabase({
        conversation: { id: "c1", user_id: "u1" },
        messages: rows,
        summary: {
          summary: "- earlier: user introduced NORPIA",
          covered_through: cutoff,
          covered_message_count: 10,
          version: 1,
        },
      }),
      conversationId: "c1",
      userId: "u1",
    });

    expect(prepared.messages[0]?.role).toBe("system");
    expect(prepared.messages[1]?.content).toContain("earlier: user introduced NORPIA");
    const replayed = prepared.messages.slice(2).map((m) => m.content);
    expect(replayed).not.toContain("message 0");
    expect(replayed.at(-1)).toBe("message 19");
    expect(prepared.stats.summaryVersion).toBe(1);
    expect(prepared.stats.summarizedMessages).toBe(10);
  });
});

describe("summary security and storage", () => {
  it("scopes summaries to the owner in SQL", () => {
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/auth\.uid\(\) = user_id/);
    expect(migration).toMatch(/grant select, insert, update, delete on public\.conversation_summaries to authenticated/);
    expect(migration).toMatch(/unique/i);
  });

  it("loads summaries with an explicit user filter", () => {
    const source = readFileSync("src/backend/ai/conversation-summary.ts", "utf8");
    expect(source).toContain('.eq("user_id", userId)');
    expect(source).not.toMatch(/SERVICE_ROLE/);
  });

  it("keeps summarisation non-fatal in the chat route", () => {
    expect(route).toContain("maybeSummarize");
    expect(route).toContain("ai.chat.summary_failed");
  });
});
