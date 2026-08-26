/**
 * OpenAI implementation of the ChatProvider contract.
 *
 * The API key is read from the server environment inside the call — it never
 * leaves this module and is never logged.
 */

import {
  AiProviderError,
  type ChatProvider,
  type ChatStreamRequest,
  type ChatStreamChunk,
} from "@/backend/ai/chat-provider";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const openAiProvider: ChatProvider = {
  id: "openai",

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<ChatStreamChunk> {
    const apiKey = typeof process !== "undefined" ? process.env?.["OPENAI_API_KEY"] : undefined;
    if (!apiKey) {
      throw new AiProviderError("The AI service is not configured yet.", 503);
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
    } catch {
      throw new AiProviderError("Could not reach the AI service. Please try again.", 502);
    }

    if (!response.ok || !response.body) {
      // Deliberately does not surface the upstream body (may echo request data).
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError("The AI service rejected this request.", 502);
      }
      if (response.status === 429) {
        throw new AiProviderError("The AI service is rate limited. Please try again shortly.", 429);
      }
      if (response.status === 408 || response.status >= 500) {
        throw new AiProviderError("The AI service is temporarily unavailable.", 502);
      }
      throw new AiProviderError("The AI request could not be completed.", 502);
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

/** Registry hook — add Anthropic/Gemini here when those providers land. */
export function resolveChatProvider(provider: string): ChatProvider {
  switch (provider) {
    case "openai":
      return openAiProvider;
    default:
      throw new AiProviderError("The selected AI provider is not available.", 400);
  }
}
