/**
 * OpenAI + Anthropic working together through one orchestration layer:
 * task routing, controlled fallback, shared context/memory, normalised
 * responses, routing telemetry and key safety. Upstream APIs are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { orchestrateChatStream } from "@/backend/ai/orchestration/orchestrator";
import { selectModelForTask } from "@/backend/ai/orchestration/model-selection";
import { getOrchestrationConfig } from "@/backend/ai/orchestration/routing-config";
import { AiProviderError, classifyHttpStatus } from "@/backend/ai/provider/provider-types";
import type { AiTurn } from "@/backend/ai/provider/provider-types";

const ENV = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "AI_FALLBACK_ENABLED",
  "AI_FALLBACK_PROVIDER", "AI_TASK_ROUTING", "AI_PROVIDER_REASONING", "AI_PROVIDER"];
const saved: Record<string, string | undefined> = {};
const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];

function sse(lines: unknown[]): Response {
  const text = lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("");
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });
}
const openAiOk = () => sse([{ choices: [{ delta: { content: "Hi from OpenAI" } }] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }]);
const anthropicOk = () => sse([
  { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
  { type: "content_block_delta", delta: { text: "Hi from Claude" } },
  { type: "message_delta", usage: { output_tokens: 5 } },
]);

let behaviour: { openai: () => Response; anthropic: () => Response };

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env["OPENAI_API_KEY"] = "sk-test-openai";
  process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
  calls.length = 0;
  behaviour = { openai: openAiOk, anthropic: anthropicOk };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return url.includes("anthropic") ? behaviour.anthropic() : behaviour.openai();
  }));
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const memoryContext: AiTurn[] = [
  { role: "system", content: "You are JARVIS." },
  { role: "system", content: "## Long-term memory\n- User's company is based in Switzerland" },
  { role: "system", content: "## Conversation summary\nDiscussed expansion." },
  { role: "user", content: "Earlier question" },
  { role: "assistant", content: "Earlier answer" },
  { role: "user", content: "What do you know about my company?" },
];

async function drain(text: string, messages = memoryContext) {
  const h = await orchestrateChatStream({ messages, classifyText: text, maxOutputTokens: 200 });
  let out = "";
  for await (const c of h.stream) out += c.delta;
  return { h, out, t: h.getTelemetry() };
}

describe("task routing", () => {
  it("general conversation stays on OpenAI (default)", async () => {
    const { out, t } = await drain("What do you know about my company?");
    expect(out).toBe("Hi from OpenAI");
    expect(t).toMatchObject({ provider: "openai", primaryProvider: "openai", usedFallback: false, success: true,
      routingReason: "provider-default", inputTokens: 10, outputTokens: 4, totalTokens: 14, usageReported: true });
    expect(calls).toHaveLength(1); // one provider, one call — no dual sending
  });
  it("reasoning is routed to Anthropic through the same layer", async () => {
    const { out, t } = await drain("Analyze the pros and cons step by step of entering Germany");
    expect(t.task).toBe("reasoning");
    expect(out).toBe("Hi from Claude");
    expect(t).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-5", routingReason: "task-route",
      inputTokens: 12, outputTokens: 5, totalTokens: 17, usageReported: true });
    expect(calls).toHaveLength(1);
  });
  it("route is skipped when Anthropic has no key, or routing is disabled", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    expect(selectModelForTask({ task: "reasoning" }).provider).toBe("openai");
    process.env["ANTHROPIC_API_KEY"] = "k";
    process.env["AI_TASK_ROUTING"] = "false";
    expect(selectModelForTask({ task: "reasoning" }).provider).toBe("openai");
  });
  it("per-task provider is configurable", () => {
    process.env["AI_PROVIDER_REASONING"] = "openai";
    expect(getOrchestrationConfig().taskProviders.reasoning).toBe("openai");
    expect(selectModelForTask({ task: "reasoning" }).provider).toBe("openai");
  });
  it("dual-provider comparison is off by default", () => {
    expect(getOrchestrationConfig().dualProviderComparison).toBe(false);
  });
});

describe("shared context and memory", () => {
  it("both providers receive system + memory + summary + recent + current", async () => {
    await drain("hello");
    process.env["AI_PROVIDER"] = "anthropic";
    await drain("hello");
    const [oa, an] = calls;
    const oaText = JSON.stringify(oa!.body["messages"]);
    expect(oaText).toContain("Switzerland");
    expect(oaText).toContain("Discussed expansion");
    expect(String(an!.body["system"])).toContain("Switzerland");
    expect(String(an!.body["system"])).toContain("Discussed expansion");
    const anMsgs = an!.body["messages"] as { role: string; content: string }[];
    expect(anMsgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(anMsgs.at(-1)!.content).toBe("What do you know about my company?");
  });
});

describe("controlled fallback", () => {
  it("off by default: a failure returns the normalised error", async () => {
    behaviour.openai = () => new Response("down", { status: 503 });
    await expect(drain("hi")).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(1);
  });
  it("enabled: transient failure falls back to Anthropic once", async () => {
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "anthropic";
    behaviour.openai = () => new Response("", { status: 429 });
    const { out, t } = await drain("hi");
    expect(out).toBe("Hi from Claude");
    expect(t).toMatchObject({ provider: "anthropic", primaryProvider: "openai", usedFallback: true, routingReason: "fallback" });
    expect(calls).toHaveLength(2);
  });
  it("request-shaped errors never fall back", async () => {
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "anthropic";
    for (const status of [400, 413]) {
      calls.length = 0;
      behaviour.openai = () => new Response("", { status });
      await expect(drain("hi")).rejects.toBeInstanceOf(AiProviderError);
      expect(calls).toHaveLength(1);
    }
  });
  it("both failing returns the original error, no loop", async () => {
    process.env["AI_FALLBACK_ENABLED"] = "true";
    process.env["AI_FALLBACK_PROVIDER"] = "anthropic";
    behaviour.openai = () => new Response("", { status: 500 });
    behaviour.anthropic = () => new Response("", { status: 529 });
    await expect(drain("hi")).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(2);
  });
});

describe("errors and security", () => {
  it("maps statuses to normalised categories", () => {
    expect(classifyHttpStatus(401)).toBe("authentication");
    expect(classifyHttpStatus(404)).toBe("model_unavailable");
    expect(classifyHttpStatus(413)).toBe("context_limit");
  });
  it("Anthropic mid-stream errors are normalised", async () => {
    process.env["AI_PROVIDER"] = "anthropic";
    behaviour.anthropic = () => sse([{ type: "error", error: { type: "overloaded_error", message: "secret detail" } }]);
    const err = await drain("hi").catch((e) => e);
    expect(err).toMatchObject({ code: "provider_unavailable" });
    expect(String(err.message)).not.toContain("secret detail");
  });
  it("keys only travel in upstream headers, never in bodies or errors", async () => {
    process.env["ANTHROPIC_WORKSPACE_ID"] = "wrkspc_1";
    process.env["AI_PROVIDER"] = "anthropic";
    await drain("hi");
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-test");
    expect(calls[0]!.headers["anthropic-workspace-id"]).toBe("wrkspc_1");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("sk-ant");
    behaviour.anthropic = () => new Response("", { status: 401 });
    const err = await drain("hi").catch((e) => e);
    expect(String(err.message)).not.toMatch(/sk-|anthropic|key/i);
  });
});
