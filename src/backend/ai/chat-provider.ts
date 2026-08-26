/**
 * Provider-agnostic streaming chat contract.
 *
 * Anthropic / Gemini / local models can be added later by implementing this
 * interface and registering them in `resolveChatProvider` — no call-site changes.
 */

export type ChatTurnRole = "system" | "user" | "assistant";

export interface ChatTurn {
  role: ChatTurnRole;
  content: string;
}

export interface ChatStreamRequest {
  messages: ChatTurn[];
  model: string;
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface ChatStreamChunk {
  delta: string;
}

export interface ChatProvider {
  id: string;
  /** Yields incremental text deltas until the model finishes. */
  streamChat(request: ChatStreamRequest): AsyncGenerator<ChatStreamChunk>;
}

/** Safe, user-facing failure raised by providers. Never contains credentials. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
