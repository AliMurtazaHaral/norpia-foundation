/**
 * Chat data layer (Week 4).
 *
 * The only place the UI touches the `conversations` / `messages` tables.
 * Every query runs as the signed-in Supabase user, so Row Level Security —
 * not these filters — is what actually enforces ownership.
 */

import { supabase } from "@/lib/supabase/client";

export type MessageRole = "user" | "assistant" | "system";

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const DEFAULT_CONVERSATION_TITLE = "New conversation";

/** Turn any thrown value into a short, user-safe sentence. */
export function mapChatError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : ((error as { message?: string } | null)?.message ?? "");
  const message = raw.toLowerCase();

  if (!navigator.onLine || message.includes("failed to fetch") || message.includes("networkerror")) {
    return "You appear to be offline. Check your connection and try again.";
  }
  if (message.includes("jwt") || message.includes("401") || message.includes("not authenticated")) {
    return "Your session has expired. Please sign in again.";
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "You do not have access to this conversation.";
  }
  if (message.includes("not found") || message.includes("no rows")) {
    return "That conversation could not be found.";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  return "Something went wrong. Please try again.";
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Conversation) ?? null;
}

export async function createConversation(title = DEFAULT_CONVERSATION_TITLE): Promise<Conversation> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title })
    .select("id, user_id, title, created_at, updated_at")
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("conversations").update({ title }).eq("id", id);
  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw error;
}

/** Ordered history for a conversation — the base for future context strategies. */
export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, user_id, role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function createMessage(input: {
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessage> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      user_id: userId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? {},
    })
    .select("id, conversation_id, user_id, role, content, metadata, created_at")
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

/**
 * Context window for the (future) model call. Kept deliberately small and
 * pure so summarisation / long-term memory / RAG can wrap it later.
 */
export interface ContextTurn {
  role: MessageRole;
  content: string;
}

export function buildConversationContext(
  messages: ChatMessage[],
  options: { maxTurns?: number; systemPrompt?: string } = {},
): ContextTurn[] {
  const { maxTurns = 20, systemPrompt } = options;
  const recent = messages.slice(-maxTurns).map((m) => ({ role: m.role, content: m.content }));
  return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...recent] : recent;
}

/** Derive a conversation title from the first user message. */
export function deriveTitle(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_CONVERSATION_TITLE;
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}
