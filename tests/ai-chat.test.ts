import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getAiModelConfig, JARVIS_SYSTEM_PROMPT } from "@/backend/ai/jarvis-prompt";
import { resolveChatProvider } from "@/backend/ai/openai-provider";

const route = readFileSync("src/routes/api/v1/ai/chat.ts", "utf8");

describe("JARVIS system prompt", () => {
  it("forbids claiming external system access", () => {
    expect(JARVIS_SYSTEM_PROMPT).toMatch(/NO integrations are connected/);
    expect(JARVIS_SYSTEM_PROMPT).toMatch(/Never claim to have performed a real-world action/);
  });
});

describe("model configuration", () => {
  it("is centralised and cost-bounded", () => {
    const config = getAiModelConfig();
    expect(config.provider).toBe("openai");
    expect(config.model.length).toBeGreaterThan(0);
    expect(config.maxOutputTokens).toBeGreaterThan(0);
    expect(config.maxHistoryMessages).toBeLessThanOrEqual(50);
  });

  it("resolves the openai provider and rejects unknown ones", () => {
    expect(resolveChatProvider("openai").id).toBe("openai");
    expect(() => resolveChatProvider("anthropic")).toThrow();
  });
});

describe("ai chat route security", () => {
  it("authenticates from the bearer token, not the client payload", () => {
    expect(route).toContain("supabase.auth.getUser()");
    expect(route).not.toMatch(/payload\.user_id/);
  });

  it("verifies conversation ownership", () => {
    expect(route).toContain('conversation.user_id !== user.id');
  });

  it("never uses the service role key", () => {
    expect(route).not.toMatch(/SERVICE_ROLE/);
  });

  it("bounds the history window and persists both messages", () => {
    expect(route).toContain("config.maxHistoryMessages");
    expect(route).toMatch(/role: "user"/);
    expect(route).toMatch(/role: "assistant"/);
  });
});

describe("client bridge", () => {
  it("never references the OpenAI key or endpoint", () => {
    const client = readFileSync("src/lib/chat/ai-client.ts", "utf8");
    expect(client).not.toMatch(/OPENAI_API_KEY|api\.openai\.com/);
  });
});
