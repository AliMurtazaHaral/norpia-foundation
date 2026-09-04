/**
 * Month 2 — Week 1: conversation-level summarisation.
 *
 * Responsibility: compress the OLDER part of a single conversation into one
 * short, factual block so long conversations stay affordable without JARVIS
 * losing the thread.
 *
 * Explicitly NOT a permanent user-memory system: a summary belongs to exactly
 * one conversation, is stored with that conversation, and is never reused
 * across conversations or users (Month 2 Week 2 owns cross-conversation memory).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatProvider } from "@/backend/ai/chat-provider";
import type { ContextConfig } from "@/backend/ai/context-config";
import type { StoredTurn } from "@/backend/ai/context-manager";

export interface ConversationSummary {
  summary: string;
  coveredThrough: string;
  coveredMessageCount: number;
  version: number;
}

/** Instruction used to produce the rolling summary. Versioned with the file. */
export const SUMMARY_PROMPT = `You compress an ongoing conversation for an AI assistant.

Write a compact briefing of the conversation so far. Preserve, in this order and only when present:
- decisions that were made
- requirements and constraints
- the user's goals
- relevant facts the user stated (names, numbers, systems, preferences for this conversation)
- unresolved questions and open items
- explicit instructions the user gave the assistant
- any other context needed to continue the conversation coherently

Rules:
- Be factual. Never invent information that is not in the conversation.
- Use short bullet points, no preamble, no closing remarks.
- Keep it under 250 words.
- Write in the language the user is using.`;

function summaryHeader(summary: string): string {
  return `Summary of the earlier part of this conversation (older messages are not replayed in full):\n${summary}`;
}

/** The block injected into the model context, or nothing when there is no summary. */
export function summaryContextBlocks(summary: ConversationSummary | null): string[] {
  return summary?.summary?.trim() ? [summaryHeader(summary.summary.trim())] : [];
}

/**
 * Loads the summary for a conversation. RLS plus the explicit user filter mean
 * a summary can only ever be read by its owner.
 */
export async function loadConversationSummary(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<ConversationSummary | null> {
  const { data, error } = await supabase
    .from("conversation_summaries")
    .select("summary, covered_through, covered_message_count, version")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    summary: string;
    covered_through: string;
    covered_message_count: number | null;
    version: number | null;
  };
  return {
    summary: row.summary,
    coveredThrough: row.covered_through,
    coveredMessageCount: row.covered_message_count ?? 0,
    version: row.version ?? 1,
  };
}

/**
 * Trigger policy — deliberately simple and configurable, never per message.
 * Summarise once a conversation has more unsummarised turns than the trigger
 * threshold allows.
 */
export function shouldSummarize(input: {
  totalMessages: number;
  summarizedMessages: number;
  config: ContextConfig;
}): boolean {
  if (!input.config.summary.enabled) return false;
  const unsummarized = input.totalMessages - input.summarizedMessages;
  return unsummarized >= input.config.summary.triggerMessages;
}

/** Turns raw turns into the transcript handed to the summariser. */
function renderTranscript(turns: StoredTurn[]): string {
  return turns
    .map((t) => `${t.role === "assistant" ? "Assistant" : t.role === "system" ? "System" : "User"}: ${t.content}`)
    .join("\n\n");
}

async function collect(provider: ChatProvider, request: Parameters<ChatProvider["streamChat"]>[0]) {
  let text = "";
  for await (const chunk of provider.streamChat(request)) text += chunk.delta;
  return text.trim();
}

/** Cost guard: never load more than this many rows to summarise in one pass. */
export const SUMMARY_MAX_SOURCE_MESSAGES = 500;

export class SummarizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummarizationError";
  }
}

/**
 * Regenerates the rolling summary for one conversation.
 *
 * Always keeps the newest `summary.keepRecentMessages` turns OUT of the summary
 * so they stay available verbatim as recent context. Returns `null` when there
 * is nothing worth summarising.
 *
 * Callers must treat failure as non-fatal: the conversation keeps working with
 * recent-message context only.
 */
export async function summarizeConversation(input: {
  supabase: SupabaseClient;
  provider: ChatProvider;
  config: ContextConfig;
  conversationId: string;
  userId: string;
  previous?: ConversationSummary | null;
}): Promise<ConversationSummary | null> {
  const { supabase, provider, config, conversationId, userId } = input;

  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    // Hard bound so summarising a very long conversation stays a cheap query.
    .limit(SUMMARY_MAX_SOURCE_MESSAGES)
    .returns<Array<{ role: StoredTurn["role"]; content: string; created_at: string }>>();

  if (error) throw new SummarizationError("Could not load the conversation for summarisation.");

  const rows = data ?? [];
  const older = rows.slice(0, Math.max(0, rows.length - config.summary.keepRecentMessages));
  if (older.length === 0) return null;

  const cutoff = older[older.length - 1]!.created_at;

  // Cap the transcript so summarisation itself cannot become expensive.
  let transcript = renderTranscript(older);
  if (transcript.length > config.summary.maxSourceCharacters) {
    transcript = transcript.slice(-config.summary.maxSourceCharacters);
  }

  const previousBlock = input.previous?.summary
    ? `Previous summary of even older messages:\n${input.previous.summary}\n\n`
    : "";

  let summary: string;
  try {
    summary = await collect(provider, {
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: `${previousBlock}Conversation to summarise:\n\n${transcript}` },
      ],
      model: config.summary.model ?? config.model,
      maxOutputTokens: config.summary.maxOutputTokens,
      temperature: 0.2,
    });
  } catch {
    throw new SummarizationError("The AI service could not produce a summary.");
  }

  if (!summary) throw new SummarizationError("The summary came back empty.");

  const version = (input.previous?.version ?? 0) + 1;
  const { error: writeError } = await supabase.from("conversation_summaries").upsert(
    {
      conversation_id: conversationId,
      user_id: userId,
      summary,
      covered_through: cutoff,
      covered_message_count: older.length,
      version,
      model: config.summary.model ?? config.model,
    },
    { onConflict: "conversation_id" },
  );

  if (writeError) throw new SummarizationError("The summary could not be saved.");

  return { summary, coveredThrough: cutoff, coveredMessageCount: older.length, version };
}
