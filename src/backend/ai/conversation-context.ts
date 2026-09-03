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

/** Chronological history for a conversation, bounded by the message limit. */
export async function loadConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<StoredTurn[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ role: StoredTurn["role"]; content: string }>>();

  if (error) throw new ContextError("Could not load the conversation history.", 500);

  // Newest-first from the database (so the LIMIT keeps recent turns),
  // reversed here so the model always receives strict chronological order.
  return (data ?? []).slice().reverse().map((row) => ({ role: row.role, content: row.content }));
}

/**
 * Full preparation step. `memoryBlocks` is the seam where summarisation /
 * long-term memory / retrieval will plug in later — nothing produces them yet.
 */
export async function prepareConversationContext(input: {
  supabase: SupabaseClient;
  conversationId: string;
  userId: string;
  config?: ContextConfig;
  memoryBlocks?: string[];
}): Promise<PreparedContext> {
  const config = input.config ?? getContextConfig();

  const conversation = await loadOwnedConversation(
    input.supabase,
    input.conversationId,
    input.userId,
  );

  const history = await loadConversationHistory(
    input.supabase,
    conversation.id,
    config.maxHistoryMessages,
  );

  const { messages, stats } = buildChatContext({
    history,
    config,
    ...(input.memoryBlocks ? { memoryBlocks: input.memoryBlocks } : {}),
  });

  const estimatedInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    conversation,
    messages,
    config,
    stats: { ...stats, estimatedInputTokens },
  };
}
