/**
 * Month 2 — Week 1: server-side conversation context preparation layer.
 *
 * This is the ONLY place that turns "an authenticated user + a conversation id"
 * into the message array sent to the model. The API route stays a thin
 * transport adapter and the frontend never assembles context.
 *
 * Flow:
 *   authenticated user → conversation ownership check → chronological history
 *   → bounded context window → messages ready for the provider
 *
 * Every query runs through the caller's RLS-scoped Supabase client, so the
 * ownership check below is defence in depth, not the only protection.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatTurn } from "@/backend/ai/chat-provider";
import { getContextConfig, type ContextConfig } from "@/backend/ai/context-config";
import { buildChatContext, estimateTokens, type StoredTurn } from "@/backend/ai/context-manager";
import {
  loadConversationSummary,
  summaryContextBlocks,
  type ConversationSummary,
} from "@/backend/ai/conversation-summary";
import {
  markMemoriesUsed,
  memoryContextBlocks,
  retrieveRelevantMemories,
} from "@/backend/memory/memory-service";

export class ContextError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ContextError";
  }
}

export interface ConversationRef {
  id: string;
  user_id: string;
  title: string | null;
  metadata: Record<string, unknown>;
  updated_at: string | null;
}

export interface PreparedContext {
  conversation: ConversationRef;
  messages: ChatTurn[];
  config: ContextConfig;
  summary: ConversationSummary | null;
  stats: {
    historyMessages: number;
    droppedMessages: number;
    contextCharacters: number;
    estimatedInputTokens: number;
    promptVersion: string;
    summaryVersion: number | null;
    summarizedMessages: number;
    /** Month 2 Week 2 — how many long-term memories were injected. */
    memoriesUsed: number;
  };
}

/**
 * Loads a conversation and verifies it belongs to `userId`.
 * A conversation id belonging to somebody else is indistinguishable from a
 * missing one (404), so ids cannot be used to probe other users' data.
 */
export async function loadOwnedConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<ConversationRef> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, metadata, updated_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new ContextError("Could not load that conversation.", 500);
  const conversation = data as ConversationRef | null;
  if (!conversation || conversation.user_id !== userId) {
    throw new ContextError("That conversation could not be found.", 404);
  }
  return conversation;
}

/**
 * Chronological history for a conversation, bounded by the message limit.
 * When `after` is supplied (the summary cutoff), only messages newer than that
 * instant are replayed verbatim — the older ones live in the summary instead,
 * so nothing is duplicated between the two blocks.
 */
export async function loadConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit: number,
  after?: string | null,
): Promise<StoredTurn[]> {
  let query = supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId);

  if (after) query = query.gt("created_at", after);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ role: StoredTurn["role"]; content: string }>>();

  if (error) throw new ContextError("Could not load the conversation history.", 500);

  // Newest-first from the database (so the LIMIT keeps recent turns),
  // reversed here so the model always receives strict chronological order.
  return (data ?? []).slice().reverse().map((row) => ({ role: row.role, content: row.content }));
}

/**
 * Full preparation step. Layers, in order:
 *   system instructions → conversation summary (older messages)
 *   → recent messages (chronological) → current user message (last recent turn)
 *
 * Since Month 2 Week 2 the layering is:
 *   system instructions → long-term user memory → conversation summary
 *   → recent messages → current user message.
 * `memoryBlocks` remains the seam for later phases (RAG).
 */
export async function prepareConversationContext(input: {
  supabase: SupabaseClient;
  conversationId: string;
  userId: string;
  config?: ContextConfig;
  memoryBlocks?: string[];
  /** Set to false to skip the summary (used by failure fallbacks / tests). */
  includeSummary?: boolean;
  /** Set to false to skip long-term memory retrieval. */
  includeMemories?: boolean;
  /**
   * Already-verified conversation from an earlier `loadOwnedConversation` in the
   * same request. Avoids a second round trip; ownership is re-asserted below so
   * a mismatched row can never slip through.
   */
  conversation?: ConversationRef;
}): Promise<PreparedContext> {
  const config = input.config ?? getContextConfig();

  const preloaded =
    input.conversation &&
    input.conversation.id === input.conversationId &&
    input.conversation.user_id === input.userId
      ? input.conversation
      : null;

  const conversation =
    preloaded ??
    (await loadOwnedConversation(input.supabase, input.conversationId, input.userId));


  // The summary is loaded with the caller's RLS-scoped client and filtered by
  // user_id, so another user's summary can never enter this context.
  const summary =
    input.includeSummary === false || !config.summary.enabled
      ? null
      : await loadConversationSummary(input.supabase, conversation.id, input.userId);

  const history = await loadConversationHistory(
    input.supabase,
    conversation.id,
    config.maxHistoryMessages,
    summary?.coveredThrough ?? null,
  );

  // Month 2 Week 2 — long-term memory. Retrieved with the caller's RLS-scoped
  // client and filtered by user_id, so only this user's memories can be used.
  // Failure is non-fatal: the conversation continues without memories.
  const lastUserTurn = [...history].reverse().find((turn) => turn.role === "user");
  let memories: Awaited<ReturnType<typeof retrieveRelevantMemories>> = [];
  if (config.memory.enabled && input.includeMemories !== false) {
    try {
      memories = await retrieveRelevantMemories(input.supabase, input.userId, {
        maxMemories: config.memory.maxMemories,
        maxCharacters: config.memory.maxCharacters,
        ...(lastUserTurn ? { query: lastUserTurn.content } : {}),
      });
    } catch {
      memories = [];
    }
  }

  const memoryBlocks = [
    ...memoryContextBlocks(memories),
    ...summaryContextBlocks(summary),
    ...(input.memoryBlocks ?? []),
  ];

  const { messages, stats } = buildChatContext({
    history,
    config,
    ...(memoryBlocks.length ? { memoryBlocks } : {}),
  });

  if (memories.length) {
    await markMemoriesUsed(
      input.supabase,
      input.userId,
      memories.map((memory) => memory.id),
    );
  }

  const estimatedInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    conversation,
    messages,
    config,
    summary,
    stats: {
      ...stats,
      estimatedInputTokens,
      summaryVersion: summary?.version ?? null,
      summarizedMessages: summary?.coveredMessageCount ?? 0,
      memoriesUsed: memories.length,
    },
  };
}
