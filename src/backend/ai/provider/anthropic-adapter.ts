/**
 * Month 2 — Week 3 (Prompt 2): Anthropic (Claude) adapter.
 *
 * The only module in NORPIA that knows the Anthropic wire format. It translates
 * the standard internal request (system instructions + context blocks + turns)
 * into the Messages API shape, streams deltas back as standard chunks, and
 * normalises every failure into an `AiProviderError`.
 *
 * OpenAI remains the active provider: Claude is only used when `AI_PROVIDER` is
 * set to `anthropic` (or a caller explicitly asks for it) AND `ANTHROPIC_API_KEY`
 * is present in the server environment. The key never leaves this module.
 */

import {
  AiProviderError,
  classifyHttpStatus,
  type AiProviderAdapter,
  type AiStreamChunk,
  type ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";
import { getProviderSettings, hasCredential } from "@/backend/ai/provider/provider-config";
import { clampOutputTokens, estimateCostUsd } from "@/backend/ai/provider/model-catalog";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function apiKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.["ANTHROPIC_API_KEY"]?.trim() : undefined;
}

/**
 * Anthropic takes system instructions in a dedicated field and only accepts
 * alternating user/assistant turns, so system messages are merged out.
 */
export function toAnthropicPayload(request: ResolvedAiChatRequest) {
  const system = request.messages
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content.trim())
    .filter(Boolean)
    .join("\n\n");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of request.messages) {
    if (turn.role === "system") continue;
    const role = turn.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    // Collapse consecutive same-role turns: the Messages API rejects them.
    if (last && last.role === role) last.content = `${last.content}\n\n${turn.content}`;
    else messages.push({ role, content: turn.content });
  }
  if (messages.length === 0 || messages[0]?.role !== "user") {
    throw AiProviderError.of("invalid_request", { provider: "anthropic" });
  }

  return {
    model: request.model,
    stream: true,
    temperature: request.temperature,
    max_tokens: clampOutputTokens(request.model, request.maxOutputTokens),
    ...(system ? { system } : {}),
    messages,
  };
}

export const anthropicAdapter: AiProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",

  isConfigured: () => hasCredential("anthropic"),

  describe() {
    const settings = getProviderSettings("anthropic")!;
    return {
      id: settings.id,
      label: settings.label,
      available: hasCredential("anthropic"),
      defaultModel: settings.defaultModel,
      models: settings.models,
    };
  },

  async *streamChat(request: ResolvedAiChatRequest): AsyncGenerator<AiStreamChunk> {
    const key = apiKey();
    if (!key) {
      throw AiProviderError.of("provider_unavailable", {
        provider: "anthropic",
        message: "The AI service is not configured yet.",
      });
    }

    const payload = toAnthropicPayload(request);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        ...(request.signal ? { signal: request.signal } : {}),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw AiProviderError.of(aborted ? "timeout" : "provider_unavailable", {
        provider: "anthropic",
        ...(aborted ? {} : { message: "Could not reach the AI service. Please try again." }),
      });
    }

    if (!response.ok || !response.body) {
      // Upstream body is never surfaced: it can echo request content.
      throw AiProviderError.of(classifyHttpStatus(response.status), { provider: "anthropic" });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw) as {
            type?: string;
            delta?: { text?: string };
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield { delta: event.delta.text };
          }
          const usage = event.message?.usage ?? event.usage;
          if (usage) {
            if (usage.input_tokens !== undefined) inputTokens = usage.input_tokens;
            if (usage.output_tokens !== undefined) outputTokens = usage.output_tokens;
          }
        } catch {
          // Ignore malformed keep-alive fragments.
        }
      }
    }

    if (inputTokens !== undefined || outputTokens !== undefined) {
      const total =
        inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + outputTokens
          : undefined;
      const cost = estimateCostUsd(request.model, {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      });
      yield {
        delta: "",
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(total !== undefined ? { totalTokens: total } : {}),
          estimated: false,
          ...(cost !== undefined ? { estimatedCostUsd: cost } : {}),
        },
      };
    }
  },
};
