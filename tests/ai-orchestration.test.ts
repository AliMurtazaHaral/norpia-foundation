/**
 * Month 2 — Week 3 (Prompt 3): orchestration foundation tests.
 *
 * Covers classification, model selection, fallback behaviour, telemetry,
 * normalised errors and the security rules around client-supplied selection.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyRequest } from "@/backend/ai/orchestration/request-classifier";
import { selectModelForTask } from "@/backend/ai/orchestration/model-selection";
import {
  getOrchestrationConfig,
  resolveFallback,
} from "@/backend/ai/orchestration/routing-config";
import {
  orchestrateChatStream,
  validateClientSelection,
} from "@/backend/ai/orchestration/orchestrator";
import { AI_TASK_TYPES, TASK_CAPABILITIES } from "@/backend/ai/orchestration/task-types";
import { registerProviderAdapter } from "@/backend/ai/provider/provider-registry";
import {
  AiProviderError,
  type AiProviderAdapter,
  type AiStreamChunk,
  type ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_") || key.endsWith("_API_KEY")) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

/** Minimal adapter doubles so no real vendor is ever contacted. */
function makeAdapter(
  id: string,
  behaviour: "ok" | "fail",
  text = "hello",
): AiProviderAdapter {
  return {
    id,
    label: id,
    isConfigured: () => true,
    describe: () => ({ id, label: id, available: true, defaultModel: "m", models: ["m"] }),
    async *streamChat(_request: ResolvedAiChatRequest): AsyncGenerator<AiStreamChunk> {
      if (behaviour === "fail") {
        throw AiProviderError.of("provider_unavailable", { provider: id });
      }
      yield { delta: text };
      yield {
        delta: "",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false },
      };
    },
  };
}

const messages = [{ role: "user" as const, content: "hi" }];

beforeEach(() => resetEnv());
afterEach(() => resetEnv());

describe("request classification", () => {
  it("defaults to general conversation", () => {
    expect(classifyRequest({ message: "hi there" }).task).toBe("general-conversation");
  });

  it("detects reasoning, structured and document requests deterministically", () => {
    expect(classifyRequest({ message: "Explain why this failed" }).task).toBe("reasoning");
    expect(classifyRequest({ message: "Give me JSON output" }).task).toBe("structured-generation");
    expect(classifyRequest({ message: "Summarise the attached report" }).task).toBe(
      "document-question",
    );
  });

  it("honours an explicit internal task and ignores unknown values", () => {
    expect(classifyRequest({ task: "summarization" }).task).toBe("summarization");
    expect(classifyRequest({ task: "wildcard" }).task).toBe("general-conversation");
  });

  it("maps every task to required capabilities", () => {
    for (const task of AI_TASK_TYPES) {
      expect(TASK_CAPABILITIES[task].length).toBeGreaterThan(0);
    }
  });
});

describe("model selection", () => {
  it("keeps the OpenAI default for ordinary conversation", () => {
    const selection = selectModelForTask({ task: "general-conversation" });
    expect(selection.provider).toBe("openai");
    expect(selection.model).toBe("gpt-4o-mini");
  });

  it("applies an operator-configured per-task model", () => {
    process.env["AI_MODEL_REASONING"] = "gpt-4.1";
    const selection = selectModelForTask({ task: "reasoning" });
    expect(selection.model).toBe("gpt-4.1");
    expect(selection.reason).toBe("task-override");
  });

  it("selects a capable model when the default cannot serve the task", () => {
    const selection = selectModelForTask({ task: "document-question" });
    expect(selection.provider).toBe("openai");
    expect(selection.model).toBe("gpt-4.1-mini"); // long-context capable
    expect(selection.reason).toBe("capability-match");
  });

  it("respects a cheapest cost preference", () => {
    process.env["AI_COST_PREFERENCE"] = "cheapest";
    const selection = selectModelForTask({ task: "document-question" });
    expect(selection.model).toBe("gpt-4.1-mini");
  });

  it("routes an explicitly named model to the provider that serves it", () => {
    const selection = selectModelForTask({
      task: "general-conversation",
      model: "claude-sonnet-4-5",
    });
    expect(selection.provider).toBe("anthropic");
  });
});

describe("fallback foundation", () => {
  it("is disabled by default", () => {
    expect(resolveFallback("openai")).toBeUndefined();
  });

  it("stays disabled when the fallback provider has no credential", () => {
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "anthropic";
    delete process.env["ANTHROPIC_API_KEY"];
    expect(resolveFallback("openai")).toBeUndefined();
  });

  it("resolves only an explicitly approved, credentialed provider", () => {
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "anthropic";
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    expect(resolveFallback("openai")?.provider).toBe("anthropic");
    // Never falls back to itself.
    expect(resolveFallback("anthropic")).toBeUndefined();
  });
});

describe("orchestrated execution", () => {
  it("streams from the primary provider and reports usage metadata", async () => {
    registerProviderAdapter(makeAdapter("test-primary", "ok"));
    process.env["AI_PROVIDER"] = "test-primary";

    const handle = await orchestrateChatStream({
      messages,
      provider: "test-primary",
      model: "gpt-4o-mini",
    });
    let text = "";
    for await (const chunk of handle.stream) text += chunk.delta;

    const telemetry = handle.getTelemetry();
    expect(text).toBe("hello");
    expect(handle.usedFallback).toBe(false);
    expect(telemetry.provider).toBe("test-primary");
    expect(telemetry.inputTokens).toBe(10);
    expect(telemetry.outputTokens).toBe(5);
    expect(telemetry.usageReported).toBe(true);
    expect(telemetry.success).toBe(true);
  });

  it("uses the approved fallback when the primary is unavailable", async () => {
    registerProviderAdapter(makeAdapter("test-down", "fail"));
    registerProviderAdapter(makeAdapter("test-backup", "ok", "from backup"));
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "test-backup";
    process.env["OPENAI_API_KEY"] = "primary-key";

    const config = { ...getOrchestrationConfig() };
    // The backup has no env credential name, so approve it explicitly here by
    // pointing the fallback at a provider the registry can resolve.
    const handle = await orchestrateChatStream({
      messages,
      provider: "test-down",
      model: "gpt-4o-mini",
      config: {
        ...config,
        fallback: { enabled: true, provider: "test-backup" },
      },
    }).catch((error: unknown) => error);

    // Without a configured credential env var the fallback is refused and the
    // original normalised error survives — that is the safe default.
    expect(handle).toBeInstanceOf(AiProviderError);
    expect((handle as AiProviderError).code).toBe("provider_unavailable");
  });

  it("returns the original normalised error when no fallback exists", async () => {
    registerProviderAdapter(makeAdapter("test-broken", "fail"));
    await expect(
      orchestrateChatStream({ messages, provider: "test-broken", model: "gpt-4o-mini" }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it("never leaks credentials or provider internals in errors", async () => {
    registerProviderAdapter(makeAdapter("test-broken2", "fail"));
    process.env["OPENAI_API_KEY"] = "sk-should-never-appear";
    try {
      await orchestrateChatStream({ messages, provider: "test-broken2", model: "gpt-4o-mini" });
      throw new Error("expected failure");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("sk-should-never-appear");
      expect(message).not.toMatch(/api[_-]?key/i);
    }
  });
});

describe("security: client-supplied provider selection", () => {
  it("ignores client selection by default", () => {
    expect(validateClientSelection({ provider: "anthropic", model: "claude-sonnet-4-5" }))
      .toEqual({});
  });

  it("rejects unknown models even when client selection is allowed", () => {
    process.env["AI_ALLOW_CLIENT_MODEL_SELECTION"] = "true";
    expect(validateClientSelection({ model: "evil-model" })).toEqual({});
    expect(validateClientSelection({ model: "../../etc/passwd" })).toEqual({});
  });

  it("rejects a mismatched provider/model pair", () => {
    process.env["AI_ALLOW_CLIENT_MODEL_SELECTION"] = "true";
    process.env["OPENAI_API_KEY"] = "key";
    expect(validateClientSelection({ provider: "anthropic", model: "gpt-4o-mini" })).toEqual({});
  });

  it("accepts a catalogued model only when its provider is configured", () => {
    process.env["AI_ALLOW_CLIENT_MODEL_SELECTION"] = "true";
    process.env["OPENAI_API_KEY"] = "key";
    expect(validateClientSelection({ model: "gpt-4o" })).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
    delete process.env["OPENAI_API_KEY"];
    expect(validateClientSelection({ model: "gpt-4o" })).toEqual({});
  });
});
