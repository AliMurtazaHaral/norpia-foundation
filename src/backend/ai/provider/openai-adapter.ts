/**
 * Month 2 — Week 3: OpenAI adapter.
 *
 * The ONLY module in NORPIA that knows the OpenAI wire format. Behaviour is
 * unchanged from the Week 4 / Month 1 implementation it replaces; the failures
 * it raises are now normalised categories instead of OpenAI-specific ones.
 *
 * The API key is read from the server environment inside the call — it never
 * leaves this module and is never logged.
 */

import {
  AiProviderError,
  classifyHttpStatus,
  type AiProviderAdapter,
  type AiStreamChunk,
  type ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";
import { getProviderSettings, hasCredential } from "@/backend/ai/provider/provider-config";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function apiKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.["OPENAI_API_KEY"]?.trim() : undefined;
}

export const openAiAdapter: AiProviderAdapter = {
  id: "openai",
  label: "OpenAI",

  isConfigured: () => hasCredential("openai"),

  describe() {
    const settings = getProviderSettings("openai")!;
    return {
      id: settings.id,
      label: settings.label,
      available: hasCredential("openai"),
      defaultModel: settings.defaultModel,
      models: settings.models,
    };
  },

  async *streamChat(request: ResolvedAiChatRequest): AsyncGenerator<AiStreamChunk> {
    const key = apiKey();
    if (!key) {
      throw AiProviderError.of("provider_unavailable", {
        provider: "openai",
        message: "The AI service is not configured yet.",
      });
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        ...(request.signal ? { signal: request.signal } : {}),
        body: JSON.stringify({
          model: request.model,
          stream: true,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw AiProviderError.of(aborted ? "timeout" : "provider_unavailable", {
        provider: "openai",
        ...(aborted ? {} : { message: "Could not reach the AI service. Please try again." }),
      });
    }

    if (!response.ok || !response.body) {
      // Deliberately does not surface the upstream body (may echo request data).
      throw AiProviderError.of(classifyHttpStatus(response.status), { provider: "openai" });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
        } catch {
          // Ignore malformed keep-alive fragments.
        }
      }
    }
  },
};
