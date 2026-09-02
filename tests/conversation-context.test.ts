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

  it("keeps future memory features declared but disabled", () => {
    const config = getContextConfig();
    expect(config.future.retrievalEnabled).toBe(false);
    expect(config.future.summarisationEnabled).toBe(false);
    expect(config.future.longTermMemoryEnabled).toBe(false);
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
