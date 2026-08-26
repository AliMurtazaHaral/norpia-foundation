import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildConversationContext,
  deriveTitle,
  mapChatError,
  type ChatMessage,
} from "../src/lib/chat/chat-api";

const migration = readFileSync("infrastructure/db/migrations/0004_chat.sql", "utf8");

function msg(role: ChatMessage["role"], content: string, i: number): ChatMessage {
  return {
    id: `m${i}`,
    conversation_id: "c1",
    user_id: "u1",
    role,
    content,
    metadata: {},
    created_at: new Date(i * 1000).toISOString(),
  };
}

describe("conversation titles", () => {
  it("derives a title from the first message", () => {
    expect(deriveTitle("  Plan my   week  ")).toBe("Plan my week");
  });
  it("truncates long titles", () => {
    expect(deriveTitle("x".repeat(200))).toHaveLength(58);
  });
  it("falls back for empty input", () => {
    expect(deriveTitle("   ")).toBe("New conversation");
  });
});

describe("conversation context", () => {
  const history = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? "assistant" : "user", `m${i}`, i));

  it("keeps only the most recent turns", () => {
    const context = buildConversationContext(history, { maxTurns: 5 });
    expect(context).toHaveLength(5);
    expect(context.at(-1)?.content).toBe("m29");
  });

  it("prepends the system prompt", () => {
    const context = buildConversationContext(history, { maxTurns: 2, systemPrompt: "You are JARVIS" });
    expect(context[0]).toEqual({ role: "system", content: "You are JARVIS" });
    expect(context).toHaveLength(3);
  });
});

describe("error mapping", () => {
  it("never leaks technical detail", () => {
    const message = mapChatError(new Error('duplicate key value violates constraint "pk"'));
    expect(message).toBe("Something went wrong. Please try again.");
  });
  it("explains an expired session", () => {
    expect(mapChatError(new Error("JWT expired"))).toMatch(/sign in again/i);
  });
  it("explains an RLS denial", () => {
    expect(mapChatError({ message: "new row violates row-level security policy" })).toMatch(
      /do not have access/i,
    );
  });
});

describe("chat migration invariants", () => {
  it("enables RLS on both tables", () => {
    expect(migration).toMatch(/alter table public\.conversations enable row level security/);
    expect(migration).toMatch(/alter table public\.messages enable row level security/);
  });

  it("scopes conversations to the authenticated user", () => {
    expect(migration).toMatch(/using \(auth\.uid\(\) = user_id\)/);
  });

  it("scopes messages through the parent conversation", () => {
    expect(migration).toMatch(/c\.user_id = auth\.uid\(\)/);
  });

  it("grants the Data API roles", () => {
    expect(migration).toMatch(/grant select, insert, update, delete on public\.conversations to authenticated/);
    expect(migration).toMatch(/grant select, insert, delete on public\.messages to authenticated/);
  });

  it("never grants anon access", () => {
    expect(migration).not.toMatch(/to anon/);
  });

  it("cascades on user deletion", () => {
    expect(migration).toMatch(/references auth\.users\(id\) on delete cascade/);
  });
});
