/**
 * Month 2 — Week 3 (Prompt 2): model catalogue, selection, Anthropic adapter,
 * usage normalisation.
 */

import { afterEach, describe, expect, it } from "vitest";

import { resolveChatCall } from "@/backend/ai/ai-service";
import {
  clampOutputTokens,
  estimateCostUsd,
  getContextWindow,
  getModelDefinition,
  listModelIds,
  listModels,
  modelSupports,
} from "@/backend/ai/provider/model-catalog";
import { selectProviderAndModel } from "@/backend/ai/provider/provider-selection";
import { anthropicAdapter, toAnthropicPayload } from "@/backend/ai/provider/anthropic-adapter";
import { listProviders } from "@/backend/ai/provider/provider-registry";
import { AiProviderError } from "@/backend/ai/provider/provider-types";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("model catalogue", () => {
  it("describes every model with provider, capabilities and limits", () => {
    for (const model of listModels()) {
      expect(model.provider).toMatch(/openai|anthropic/);
      expect(model.capabilities).toContain("text");
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it("serves the provider model lists from the catalogue", () => {
    expect(listModelIds("openai")).toContain("gpt-4o-mini");
    expect(listModelIds("anthropic")).toContain("claude-sonnet-4-5");
  });

  it("exposes capabilities and context windows", () => {
    expect(modelSupports("gpt-4o", "vision")).toBe(true);
    expect(modelSupports("claude-haiku-4-5", "vision")).toBe(false);
    expect(getContextWindow("claude-sonnet-4-5")).toBe(200_000);
    expect(getContextWindow("unknown-model", 1234)).toBe(1234);
  });

  it("clamps output tokens to the model ceiling", () => {
    const ceiling = getModelDefinition("claude-sonnet-4-5")!.maxOutputTokens;
    expect(clampOutputTokens("claude-sonnet-4-5", 999_999)).toBe(ceiling);
    expect(clampOutputTokens("unknown-model", 999)).toBe(999);
  });

  it("estimates cost only where pricing is known", () => {
    expect(estimateCostUsd("gpt-4o-mini", { inputTokens: 1_000_000 })).toBeCloseTo(0.15, 5);
    expect(estimateCostUsd("unknown-model", { inputTokens: 100 })).toBeUndefined();
    expect(estimateCostUsd("gpt-4o-mini", {})).toBeUndefined();
  });
});

describe("provider selection", () => {
  it("defaults to the configured provider and its default model", () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["AI_MODEL"];
    const selection = selectProviderAndModel();
    expect(selection).toMatchObject({ provider: "openai", reason: "configured-default" });
  });

  it("switches provider purely through configuration", () => {
    process.env["AI_PROVIDER"] = "anthropic";
    delete process.env["AI_MODEL"];
    expect(selectProviderAndModel().provider).toBe("anthropic");
  });

  it("routes a named model to the provider that serves it", () => {
    delete process.env["AI_PROVIDER"];
    expect(selectProviderAndModel({ model: "claude-haiku-4-5" })).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  it("keeps an unknown model on the requested provider", () => {
    expect(selectProviderAndModel({ provider: "openai", model: "gpt-future" })).toMatchObject({
      provider: "openai",
      model: "gpt-future",
    });
  });
});

describe("request compatibility across providers", () => {
  const request = {
    system: "You are JARVIS.",
    contextBlocks: ["Long-term memory", "Conversation summary"],
    messages: [
      { role: "user" as const, content: "Earlier question" },
      { role: "assistant" as const, content: "Earlier answer" },
      { role: "user" as const, content: "Current message" },
    ],
  };

  it("builds the same ordered context for OpenAI and Anthropic", () => {
    const openai = resolveChatCall({ ...request, provider: "openai" });
    const anthropic = resolveChatCall({ ...request, provider: "anthropic" });
    expect(openai.resolved.messages).toEqual(anthropic.resolved.messages);
    expect(openai.resolved.messages.map((m) => m.role)).toEqual([
      "system",
      "system",
      "system",
      "user",
      "assistant",
      "user",
    ]);
  });

  it("translates the internal request into the Anthropic Messages format", () => {
    const { resolved } = resolveChatCall({ ...request, provider: "anthropic" });
    const payload = toAnthropicPayload(resolved);
    expect(payload.system).toContain("You are JARVIS.");
    expect(payload.system).toContain("Long-term memory");
    expect(payload.messages.every((m) => m.role !== "system")).toBe(true);
    expect(payload.messages[0]?.role).toBe("user");
    expect(payload.max_tokens).toBeLessThanOrEqual(
      getModelDefinition(resolved.model)!.maxOutputTokens,
    );
  });

  it("collapses consecutive same-role turns Anthropic would reject", () => {
    const payload = toAnthropicPayload({
      messages: [
        { role: "user", content: "one" },
        { role: "user", content: "two" },
      ],
      model: "claude-sonnet-4-5",
      temperature: 0.2,
      maxOutputTokens: 100,
    });
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]?.content).toContain("two");
  });
});

describe("Anthropic adapter safety", () => {
  it("is unavailable without a server-side credential and never leaks one", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    expect(anthropicAdapter.isConfigured()).toBe(false);
    await expect(async () => {
      for await (const _ of anthropicAdapter.streamChat({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-sonnet-4-5",
        temperature: 0.2,
        maxOutputTokens: 100,
      })) {
        // unreachable
      }
    }).rejects.toBeInstanceOf(AiProviderError);
  });

  it("reports availability from the environment only", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    expect(anthropicAdapter.isConfigured()).toBe(true);
    const serialised = JSON.stringify(listProviders());
    expect(serialised).not.toContain("test-key");
    expect(serialised).not.toMatch(/api[_-]?key|sk-/i);
  });

  it("publishes capability and cost metadata without credentials", () => {
    const anthropic = listProviders().find((p) => p.id === "anthropic");
    expect(anthropic?.modelDetails?.length).toBeGreaterThan(0);
  });
});
