/**
 * Conversation context management (Week 4 — basic memory).
 *
 * Responsibility: turn stored messages into the bounded message array that is
 * sent to the model. Keeps a clear separation between:
 *   1. system instructions  (the versioned JARVIS prompt)
 *   2. conversation history (recent turns, bounded)
 *   3. the current user message (already the last history turn)
 *
 * Deliberately pure and provider-agnostic so later phases can plug in
 * summarisation, long-term memory and RAG through `MemorySource` without
 * touching the API route.
 */

import type { ChatTurn } from "@/backend/ai/chat-provider";
import { getSystemPrompt, type AiModelConfig } from "@/backend/ai/jarvis-prompt";

export interface StoredTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Future extension point: a summariser, a long-term memory store, or a RAG
 * retriever implements this and its output is injected right after the system
 * prompt. Nothing implements it yet — advanced RAG is out of scope for Week 4.
 */
export interface MemorySource {
  id: string;
  /** Returns extra context blocks (already token-bounded by the source). */
  recall(input: { conversationId: string; query: string }): Promise<string[]>;
}

export interface BuiltContext {
  messages: ChatTurn[];
  /** Diagnostics for cost logging — never contains message content. */
  stats: {
    historyMessages: number;
    droppedMessages: number;
    contextCharacters: number;
    promptVersion: string;
  };
}

/**
 * Prioritises recent context: keeps the newest messages first and drops the
 * oldest ones once the message limit, the character budget, or (when supplied)
 * the estimated input-token budget is hit.
 */
export function buildChatContext(input: {
  history: StoredTurn[];
  config: AiModelConfig & { maxInputTokens?: number };
  memoryBlocks?: string[];
}): BuiltContext {
  const { history, config, memoryBlocks = [] } = input;

  const ordered = history.filter((m) => m.content?.trim());
  const windowed = ordered.slice(-config.maxHistoryMessages);

  // Fixed cost of the system instructions + any memory blocks.
  const systemCharacters =
    getSystemPrompt(config.promptVersion).length +
    memoryBlocks.reduce((sum, block) => sum + block.length, 0);
  const tokenBudgetCharacters =
    typeof config.maxInputTokens === "number" && config.maxInputTokens > 0
      ? Math.max(0, config.maxInputTokens * 4 - systemCharacters)
      : Number.POSITIVE_INFINITY;
  const budget = Math.min(config.maxContextCharacters, tokenBudgetCharacters);

  // Character budget, applied newest-first so the latest turns always survive.
  const kept: StoredTurn[] = [];
  let characters = 0;
  for (let i = windowed.length - 1; i >= 0; i -= 1) {
    const turn = windowed[i]!;
    const cost = turn.content.length;
    // Always keep the most recent message, even if it alone exceeds the budget.
    if (kept.length > 0 && characters + cost > budget) break;
    characters += cost;
    kept.unshift(turn);
  }


  const messages: ChatTurn[] = [
    { role: "system", content: getSystemPrompt(config.promptVersion) },
    ...memoryBlocks.map((block) => ({ role: "system" as const, content: block })),
    ...kept.map((turn) => ({ role: turn.role, content: turn.content })),
  ];

  return {
    messages,
    stats: {
      historyMessages: kept.length,
      droppedMessages: ordered.length - kept.length,
      contextCharacters: characters,
      promptVersion: config.promptVersion,
    },
  };
}

/** Rough token estimate (~4 chars/token) — good enough for cost logging. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
