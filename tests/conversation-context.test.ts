import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getContextConfig, getModelContextLimit } from "@/backend/ai/context-config";
import { buildChatContext, type StoredTurn } from "@/backend/ai/context-manager";
import {
  ContextError,
  loadConversationHistory,
  loadOwnedConversation,
  prepareConversationContext,
} from "@/backend/ai/conversation-context";

const route = readFileSync("src/routes/api/v1/ai/chat.ts", "utf8");

/** Minimal Supabase query-builder stub covering the calls the layer makes. */
function stubSupabase(options: {
  conversation?: { id: string; user_id: string; title?: string } | null;
  messages?: Array<{ role: StoredTurn["role"]; content: string }>;
}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain,
        eq: chain,
        order: chain,
        limit: chain,
        returns: chain,
        maybeSingle: async () => ({ data: options.conversation ?? null, error: null }),
        then: undefined,
      });
      if (table === "messages") {
        // newest-first, as the real query orders it
        const rows = [...(options.messages ?? [])].reverse();
        Object.assign(builder, {
          returns: () => Promise.resolve({ data: rows, error: null }),
        });
      }
      return builder;
    },
  } as never;
}

describe("context configuration", () => {
  it("is centralized and model-aware", () => {
    const config = getContextConfig();
    expect(config.maxInputTokens).toBeGreaterThan(0);
    expect(config.maxHistoryMessages).toBeGreaterThan(0);
    expect(getModelContextLimit("gpt-4o-mini")).toBeGreaterThan(0);
    expect(getModelContextLimit("unknown-model")).toBeGreaterThan(0);
  });

  it("keeps later-phase retrieval disabled (summarisation M2W1, memory M2W2)", () => {
    const config = getContextConfig();
    expect(config.future.retrievalEnabled).toBe(false);
    expect(config.future.longTermMemoryEnabled).toBe(true);
    expect(config.summary.enabled).toBe(true);
  });
});

describe("token budget", () => {
  it("drops old turns when the input-token budget is small", () => {
    const config = { ...getContextConfig(), maxInputTokens: 10 };
    const history: StoredTurn[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "x".repeat(200),
    }));
    const { stats } = buildChatContext({ history, config });
    expect(stats.droppedMessages).toBeGreaterThan(0);
  });
});

describe("conversation ownership", () => {
  it("rejects a conversation owned by another user as not found", async () => {
    const supabase = stubSupabase({ conversation: { id: "c1", user_id: "someone-else" } });
    await expect(loadOwnedConversation(supabase, "c1", "me")).rejects.toBeInstanceOf(ContextError);
  });

  it("returns the conversation for its owner", async () => {
    const supabase = stubSupabase({ conversation: { id: "c1", user_id: "me" } });
    await expect(loadOwnedConversation(supabase, "c1", "me")).resolves.toMatchObject({ id: "c1" });
  });
});

describe("history preparation", () => {
  it("returns messages in chronological order", async () => {
    const supabase = stubSupabase({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    });
    const history = await loadConversationHistory(supabase, "c1", 20);
    expect(history.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("prepares a context that starts with the system prompt", async () => {
    const supabase = stubSupabase({
      conversation: { id: "c1", user_id: "me" },
      messages: [{ role: "user", content: "My company is called NORPIA." }],
    });
    const prepared = await prepareConversationContext({
      supabase,
      conversationId: "c1",
      userId: "me",
    });
    expect(prepared.messages[0]?.role).toBe("system");
    expect(prepared.messages.at(-1)?.content).toContain("NORPIA");
    expect(prepared.stats.estimatedInputTokens).toBeGreaterThan(0);
  });
});

describe("chat route uses the shared context layer", () => {
  it("delegates ownership and context preparation", () => {
    expect(route).toContain("loadOwnedConversation");
    expect(route).toContain("prepareConversationContext");
    expect(route).toContain("getContextConfig");
  });

  it("still authenticates from the bearer token and never uses the service role", () => {
    expect(route).toContain("supabase.auth.getUser()");
    expect(route).not.toMatch(/SERVICE_ROLE/);
  });
});

describe("month 2 week 1 — QA hardening", () => {
  it("reuses an already-verified conversation instead of re-querying", async () => {
    let conversationLookups = 0;
    const base = stubSupabase({
      conversation: { id: "c1", user_id: "u1" },
      messages: [{ role: "user", content: "hello" }],
    }) as unknown as { from: (table: string) => unknown };
    const counting = {
      from(table: string) {
        if (table === "conversations") conversationLookups += 1;
        return base.from(table);
      },
    } as never;

    const prepared = await prepareConversationContext({
      supabase: counting,
      conversationId: "c1",
      userId: "u1",
      includeSummary: false,
      conversation: {
        id: "c1",
        user_id: "u1",
        title: null,
        metadata: {},
        updated_at: null,
      },
    });

    expect(conversationLookups).toBe(0);
    expect(prepared.conversation.id).toBe("c1");
  });

  it("ignores a preloaded conversation that does not match the caller", async () => {
    await expect(
      prepareConversationContext({
        supabase: stubSupabase({ conversation: null }),
        conversationId: "c1",
        userId: "u1",
        includeSummary: false,
        conversation: {
          id: "c1",
          user_id: "someone-else",
          title: null,
          metadata: {},
          updated_at: null,
        },
      }),
    ).rejects.toBeInstanceOf(ContextError);
  });

  it("skips the summary bookkeeping query when summarisation is disabled", () => {
    expect(route).toContain("if (!input.config.summary.enabled) return;");
  });

  it("bounds the rows loaded for summarisation", () => {
    const summary = readFileSync("src/backend/ai/conversation-summary.ts", "utf8");
    expect(summary).toContain("SUMMARY_MAX_SOURCE_MESSAGES");
    expect(summary).toMatch(/\.limit\(SUMMARY_MAX_SOURCE_MESSAGES\)/);
  });

  it("never exposes provider keys or raw errors to the client", () => {
    expect(route).not.toMatch(/OPENAI_API_KEY/);
    expect(route).not.toMatch(/error\.stack/);
  });
});
