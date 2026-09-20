/**
 * Month 2 — Week 3: the NORPIA AI layer.
 *
 * Everything in NORPIA that needs a model calls THIS module. It resolves the
 * configured provider, fills in defaults, normalises failures and returns
 * standardised results, so no caller depends on OpenAI (or any future vendor).
 *
 *   JARVIS → ai-service → provider registry → adapter → vendor API
 */

import { getContextConfig } from "@/backend/ai/context-config";
import { resolveProvider } from "@/backend/ai/provider/provider-registry";
import { getDefaultModel } from "@/backend/ai/provider/provider-config";
import { selectProviderAndModel } from "@/backend/ai/provider/provider-selection";
import { clampOutputTokens, estimateCostUsd } from "@/backend/ai/provider/model-catalog";
import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResponse,
  type AiProviderAdapter,
  type AiProviderId,
  type AiStreamChunk,
  type AiTurn,
  type ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";

/** System instructions + context blocks + conversation turns, in order. */
function composeMessages(request: AiChatRequest): AiTurn[] {
  const prefix: AiTurn[] = [];
  if (request.system?.trim()) prefix.push({ role: "system", content: request.system.trim() });
  for (const block of request.contextBlocks ?? []) {
    if (block.trim()) prefix.push({ role: "system", content: block.trim() });
  }
  return [...prefix, ...request.messages];
}

export interface ResolvedCall {
  adapter: AiProviderAdapter;
  provider: AiProviderId;
  resolved: ResolvedAiChatRequest;
}

/** Applies configuration defaults and resolves the adapter. Never throws raw errors. */
export function resolveChatCall(request: AiChatRequest): ResolvedCall {
  const config = getContextConfig();
  const selection = selectProviderAndModel({
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.model ? { model: request.model } : {}),
  });
  const adapter = resolveProvider(selection.provider);

  const messages = composeMessages(request);
  if (!messages.some((turn) => turn.role === "user")) {
    throw AiProviderError.of("invalid_request", { provider: selection.provider });
  }

  const model = selection.model || getDefaultModel(adapter.id) || config.model;

  return {
    adapter,
    provider: adapter.id,
    resolved: {
      messages,
      model,
      temperature: request.temperature ?? config.temperature,
      maxOutputTokens: clampOutputTokens(model, request.maxOutputTokens ?? config.maxOutputTokens),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.metadata ? { metadata: request.metadata } : {}),
    },
  };
}

export interface ChatStreamHandle {
  provider: AiProviderId;
  model: string;
  /** Incremental text deltas, provider-agnostic. */
  stream: AsyncGenerator<AiStreamChunk>;
}

/**
 * Streaming entry point used by the JARVIS chat endpoint. The returned stream
 * yields normalised deltas; any failure surfaces as an `AiProviderError`.
 */
export function streamChat(request: AiChatRequest): ChatStreamHandle {
  const { adapter, provider, resolved } = resolveChatCall(request);
  return { provider, model: resolved.model, stream: adapter.streamChat(resolved) };
}

/**
 * Non-streaming entry point (summaries, memory extraction, any one-shot call).
 * Collects the stream and returns a standardised response.
 */
export async function generateText(request: AiChatRequest): Promise<AiChatResponse> {
  const startedAt = Date.now();
  const { adapter, provider, resolved } = resolveChatCall(request);

  let content = "";
  for await (const chunk of adapter.streamChat(resolved)) content += chunk.delta;
  content = content.trim();

  return {
    content,
    provider,
    model: resolved.model,
    usage: { estimated: true },
    metadata: {
      finishReason: content ? "completed" : "empty",
      durationMs: Date.now() - startedAt,
      ...(request.metadata ?? {}),
    },
  };
}

export { AiProviderError };
