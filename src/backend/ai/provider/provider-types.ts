/**
 * Month 2 — Week 3: provider-agnostic AI contracts.
 *
 * These types are the ONLY vocabulary the rest of NORPIA uses when it talks to
 * a model. Anything OpenAI-, Anthropic- or vendor-specific lives inside an
 * adapter behind `AiProviderAdapter` and never leaks past this boundary.
 *
 *   JARVIS → NORPIA AI layer → AiProviderAdapter → OpenAI / Claude / future
 */

export type AiProviderId = "openai" | "anthropic" | (string & {});

export type AiTurnRole = "system" | "user" | "assistant";

export interface AiTurn {
  role: AiTurnRole;
  content: string;
}

/* ------------------------------------------------------------- Requests */

/**
 * Standardised request (Task 2). Deliberately small: everything a provider can
 * reasonably honour, nothing speculative.
 */
export interface AiChatRequest {
  /** System instructions; adapters map this to their own system channel. */
  system?: string;
  /** Long-term memories / summary blocks already rendered as text. */
  contextBlocks?: string[];
  /** Conversation context plus the current user message, chronological. */
  messages: AiTurn[];
  /** Provider to use; defaults to the configured active provider. */
  provider?: AiProviderId;
  /** Model id; defaults to the provider's configured default model. */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Soft ceiling on input tokens; enforced by the context layer. */
  maxInputTokens?: number;
  signal?: AbortSignal;
  /** Free-form, content-free tracing data (ids, feature name, prompt version). */
  metadata?: Record<string, string | number | boolean | null>;
}

/** The shape an adapter receives: always fully resolved, never optional. */
export interface ResolvedAiChatRequest {
  messages: AiTurn[];
  model: string;
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
  metadata?: Record<string, string | number | boolean | null>;
}

/* ------------------------------------------------------------ Responses */

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** True when the numbers are estimates rather than provider-reported. */
  estimated: boolean;
}

export interface AiStreamChunk {
  delta: string;
}

/** Standardised response (Task 3) — the caller never inspects raw payloads. */
export interface AiChatResponse {
  content: string;
  provider: AiProviderId;
  model: string;
  usage?: AiUsage;
  metadata: {
    finishReason: "completed" | "empty" | "interrupted";
    durationMs: number;
    [key: string]: unknown;
  };
}

/* --------------------------------------------------------------- Errors */

/** Normalised failure categories (Task 6). No provider wording, ever. */
export type AiErrorCode =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "invalid_request"
  | "provider_unavailable"
  | "provider_error";

const USER_MESSAGES: Record<AiErrorCode, string> = {
  authentication: "The AI service rejected this request.",
  rate_limit: "The AI service is rate limited. Please try again shortly.",
  timeout: "The AI service took too long to respond. Please try again.",
  invalid_request: "That request could not be processed.",
  provider_unavailable: "The AI service is not available right now.",
  provider_error: "The AI request could not be completed.",
};

const HTTP_STATUS: Record<AiErrorCode, number> = {
  authentication: 502,
  rate_limit: 429,
  timeout: 504,
  invalid_request: 400,
  provider_unavailable: 503,
  provider_error: 502,
};

/**
 * Safe, user-facing provider failure. Never contains credentials, upstream
 * bodies, or the provider's own error text.
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly provider: AiProviderId | undefined;

  constructor(
    message: string,
    status: number,
    options?: { code?: AiErrorCode; provider?: AiProviderId },
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = options?.code ?? "provider_error";
    this.status = status;
    this.provider = options?.provider;
  }

  /** Preferred constructor: message and status derived from the category. */
  static of(
    code: AiErrorCode,
    options?: { provider?: AiProviderId; message?: string },
  ): AiProviderError {
    return new AiProviderError(options?.message ?? USER_MESSAGES[code], HTTP_STATUS[code], {
      code,
      ...(options?.provider ? { provider: options.provider } : {}),
    });
  }
}

/** Maps any upstream HTTP status onto a normalised category. */
export function classifyHttpStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
}

/* ------------------------------------------------------------- Adapters */

export interface AiProviderDescriptor {
  id: AiProviderId;
  label: string;
  /** False when credentials are missing — surfaced by configuration, not errors. */
  available: boolean;
  defaultModel: string;
  models: string[];
  status: "active" | "configured" | "planned";
}

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  readonly label: string;
  /** Credentials present in the server environment. */
  isConfigured(): boolean;
  describe(): Omit<AiProviderDescriptor, "status">;
  /** Incremental text deltas until the model finishes. */
  streamChat(request: ResolvedAiChatRequest): AsyncGenerator<AiStreamChunk>;
}
