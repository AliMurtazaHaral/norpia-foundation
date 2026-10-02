/**
 * Month 2 — Week 3: AI provider abstraction.
 */

import { afterEach, describe, expect, it } from "vitest";

import { generateText, resolveChatCall } from "@/backend/ai/ai-service";
import {
  getActiveProviderId,
  getDefaultModel,
  hasCredential,
} from "@/backend/ai/provider/provider-config";
import {
  listProviders,
  registerProviderAdapter,
  resolveProvider,
} from "@/backend/ai/provider/provider-registry";
import {
  AiProviderError,
  classifyHttpStatus,
  type AiProviderAdapter,
} from "@/backend/ai/provider/provider-types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function fakeAdapter(id: string, text: string): AiProviderAdapter {
  return {
    id,
    label: id,
    isConfigured: () => true,
    describe: () => ({ id, label: id, available: true, defaultModel: "test-model", models: ["test-model"] }),
    async *streamChat() {
      yield { delta: text };
    },
  };
}

describe("provider configuration", () => {
  it("defaults to OpenAI as the active provider", () => {
    delete process.env["AI_PROVIDER"];
    expect(getActiveProviderId()).toBe("openai");
  });

  it("honours AI_PROVIDER but ignores unknown values", () => {
    process.env["AI_PROVIDER"] = "anthropic";
    expect(getActiveProviderId()).toBe("anthropic");
    process.env["AI_PROVIDER"] = "not-a-provider";
    expect(getActiveProviderId()).toBe("openai");
  });

  it("uses AI_MODEL for the active provider and the built-in default otherwise", () => {
    delete process.env["AI_PROVIDER"];
    process.env["AI_MODEL"] = "gpt-4o";
    expect(getDefaultModel("openai")).toBe("gpt-4o");
    expect(getDefaultModel("anthropic")).toBe("claude-sonnet-4-6");
  });

  it("reports availability from server-side credentials only", () => {
    delete process.env["OPENAI_API_KEY"];
    expect(hasCredential("openai")).toBe(false);
    process.env["OPENAI_API_KEY"] = "sk-test";
    expect(hasCredential("openai")).toBe(true);
  });

  it("lists providers without exposing any credential", () => {
    const providers = listProviders();
    const serialised = JSON.stringify(providers);
    expect(providers.map((p) => p.id)).toContain("openai");
    expect(providers.map((p) => p.id)).toContain("anthropic");
    expect(serialised).not.toMatch(/api[_-]?key|sk-/i);
  });
});

describe("provider registry", () => {
  it("resolves the active provider by default", () => {
    delete process.env["AI_PROVIDER"];
    expect(resolveProvider().id).toBe("openai");
  });

  it("fails safely for an unknown provider", () => {
    try {
      resolveProvider("does-not-exist");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).code).toBe("provider_unavailable");
    }
  });

  it("accepts a newly registered adapter without touching call sites", async () => {
    registerProviderAdapter(fakeAdapter("test-provider", "hello"));
    const response = await generateText({
      provider: "test-provider",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.content).toBe("hello");
    expect(response.provider).toBe("test-provider");
  });

  it("Claude without a key fails safely", async () => {
    const saved = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    const adapter = resolveProvider("anthropic");
    expect(adapter.isConfigured()).toBe(false);
    await expect(async () => {
      for await (const _ of adapter.streamChat({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-sonnet-4-6",
        temperature: 0.2,
        maxOutputTokens: 100,
      })) {
        // unreachable
      }
    }).rejects.toBeInstanceOf(AiProviderError);
    if (saved !== undefined) process.env["ANTHROPIC_API_KEY"] = saved;
  });
});

describe("standardised request", () => {
  it("places system instructions and context blocks before the conversation", () => {
    const { resolved } = resolveChatCall({
      system: "You are JARVIS.",
      contextBlocks: ["Long-term memory"],
      messages: [{ role: "user", content: "hi" }],
      provider: "openai",
    });
    expect(resolved.messages.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(resolved.messages[1]?.content).toBe("Long-term memory");
  });

  it("rejects a request with no user message", () => {
    expect(() =>
      resolveChatCall({ messages: [{ role: "system", content: "only system" }] }),
    ).toThrow(AiProviderError);
  });

  it("applies configured defaults for model, temperature and output tokens", () => {
    delete process.env["AI_PROVIDER"];
    process.env["AI_MODEL"] = "gpt-4o-mini";
    const { resolved } = resolveChatCall({ messages: [{ role: "user", content: "hi" }] });
    expect(resolved.model).toBe("gpt-4o-mini");
    expect(resolved.temperature).toBeTypeOf("number");
    expect(resolved.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("standardised response", () => {
  it("reports provider, model and finish reason", async () => {
    registerProviderAdapter(fakeAdapter("echo-provider", "answer"));
    const response = await generateText({
      provider: "echo-provider",
      messages: [{ role: "user", content: "hi" }],
      model: "test-model",
    });
    expect(response).toMatchObject({ provider: "echo-provider", model: "test-model" });
    expect(response.metadata.finishReason).toBe("completed");
    expect(response.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks an empty generation instead of pretending it succeeded", async () => {
    registerProviderAdapter(fakeAdapter("empty-provider", "   "));
    const response = await generateText({
      provider: "empty-provider",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.metadata.finishReason).toBe("empty");
  });
});

describe("normalised errors", () => {
  it("maps upstream statuses onto provider-agnostic categories", () => {
    expect(classifyHttpStatus(401)).toBe("authentication");
    expect(classifyHttpStatus(429)).toBe("rate_limit");
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(400)).toBe("invalid_request");
    expect(classifyHttpStatus(503)).toBe("provider_unavailable");
  });

  it("never leaks provider wording or credentials to the user", () => {
    for (const code of [
      "authentication",
      "rate_limit",
      "timeout",
      "invalid_request",
      "provider_unavailable",
      "provider_error",
    ] as const) {
      const error = AiProviderError.of(code, { provider: "openai" });
      expect(error.message).not.toMatch(/openai|anthropic|api[_-]?key|sk-|bearer/i);
      expect(error.status).toBeGreaterThanOrEqual(400);
    }
  });
});
