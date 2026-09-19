/**
 * Streaming chat contract — compatibility surface.
 *
 * Since Month 2 Week 3 the canonical contracts live in
 * `src/backend/ai/provider/provider-types.ts`. This module keeps the original
 * names (`ChatProvider`, `ChatTurn`, `AiProviderError`) working for existing
 * call sites and tests, and defines the minimal structural shape internal
 * helpers (summarisation, memory extraction) depend on.
 */

import type {
  AiStreamChunk,
  AiTurn,
  AiTurnRole,
  ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";

export { AiProviderError } from "@/backend/ai/provider/provider-types";

export type ChatTurnRole = AiTurnRole;
export type ChatTurn = AiTurn;
export type ChatStreamRequest = ResolvedAiChatRequest;
export type ChatStreamChunk = AiStreamChunk;

/** Minimal streaming surface: every registered adapter satisfies it. */
export interface ChatProvider {
  id: string;
  streamChat(request: ChatStreamRequest): AsyncGenerator<ChatStreamChunk>;
}
