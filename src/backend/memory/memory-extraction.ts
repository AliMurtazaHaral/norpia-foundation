/**
 * Month 2 — Week 2 (Prompt 2): server-side long-term memory extraction.
 *
 * After a conversation has produced enough new turns, JARVIS re-reads the
 * unanalysed part and proposes durable facts about the USER. Everything here
 * runs server-side with the caller's RLS-scoped client, so a candidate can only
 * ever be written for the authenticated user.
 *
 * Deliberately simple: one model call, deterministic filtering, string-overlap
 * duplicate detection. No embeddings, no vector search (later roadmap stages).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ChatProvider } from "@/backend/ai/chat-provider";
import type { ContextConfig } from "@/backend/ai/context-config";
import type { StoredTurn } from "@/backend/ai/context-manager";
import {
  MEMORY_CATEGORIES,
  MEMORY_MAX_CONTENT_LENGTH,
  type UserMemory,
} from "@/backend/memory/memory-types";

export class MemoryExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryExtractionError";
  }
}

/* --------------------------------------------------------------- Prompting */

export const MEMORY_EXTRACTION_PROMPT = `You maintain the long-term memory of an AI assistant about ONE user.

A memory is information about the user that stays useful in FUTURE, unrelated conversations.

Store only:
- stable preferences ("prefers concise answers")
- explicit standing instructions ("always answer in German")
- long-term goals
- professional context (role, company, industry)
- ongoing projects
- important business context
- recurring requirements
- durable facts that make future help better

Never store:
- temporary details of the current conversation
- small talk, moods, one-off requests
- anything already covered by an existing memory
- speculation, guesses, or information the user did not state
- assistant output, code, or generated content

Rules:
- Write each memory as one short third-person sentence starting with "User".
- Be conservative: returning an empty list is correct when nothing is durable.
- If new information makes an EXISTING memory outdated, return the candidate and
  set "replaces" to the exact text of that existing memory.
- confidence: 0-1, how certain you are the user actually stated this.
- importance: 1 (nice to know) to 5 (always relevant).

Answer with JSON only, in this shape:
{"memories":[{"content":"...","category":"preference","importance":3,"confidence":0.9,"replaces":null}]}

Allowed categories: ${MEMORY_CATEGORIES.join(", ")}.`;

const candidateSchema = z.object({
  content: z.string().trim().min(3).max(MEMORY_MAX_CONTENT_LENGTH),
  category: z.enum(MEMORY_CATEGORIES).catch("other"),
  importance: z.coerce.number().int().min(1).max(5).catch(3),
  confidence: z.coerce.number().min(0).max(1).catch(0.8),
  replaces: z.string().trim().min(1).nullish(),
});

export type MemoryCandidate = z.infer<typeof candidateSchema>;

/** Tolerant JSON parsing: models sometimes wrap the object in prose or fences. */
export function parseCandidates(raw: string): MemoryCandidate[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = (parsed as { memories?: unknown })?.memories;
  if (!Array.isArray(list)) return [];

  return list.flatMap((entry) => {
    const result = candidateSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

/* ------------------------------------------------------ Duplicate detection */

const STOP_WORDS = new Set([
  "user", "the", "and", "for", "with", "that", "this", "you", "your", "are",
  "was", "our", "have", "has", "can", "his", "her", "their", "they", "them",
  "prefers", "wants", "likes",
]);

/**
 * Small synonym table so obvious paraphrases collapse onto the same token
 * ("short and direct responses" ≈ "concise answers"). Cheap stand-in for the
 * embeddings that belong to a later roadmap stage.
 */
const SYNONYMS: Record<string, string> = {
  responses: "answer",
  response: "answer",
  answers: "answer",
  replies: "answer",
  reply: "answer",
  messages: "answer",
  short: "concise",
  brief: "concise",
  succinct: "concise",
  terse: "concise",
  direct: "concise",
  company: "company",
  business: "company",
  firm: "company",
  employer: "company",
  building: "project",
  project: "project",
  projects: "project",
  working: "project",
  goal: "goal",
  goals: "goal",
  objective: "goal",
};

function normalize(word: string): string {
  const mapped = SYNONYMS[word];
  if (mapped) return mapped;
  // Very light stemming so plurals do not look like different facts.
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .map(normalize),
  );
}

/** Jaccard overlap of significant words: 0 = unrelated, 1 = the same statement. */
export function contentSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function findSimilarMemory(
  content: string,
  existing: UserMemory[],
  threshold: number,
): UserMemory | null {
  let best: UserMemory | null = null;
  let bestScore = threshold;
  for (const memory of existing) {
    const score = contentSimilarity(content, memory.content);
    if (score >= bestScore) {
      best = memory;
      bestScore = score;
    }
  }
  return best;
}

/* ------------------------------------------------------------- Reconciliation */

export interface MemoryPlan {
  creates: MemoryCandidate[];
  /** Existing memory refreshed with better/newer wording or importance. */
  updates: Array<{ id: string; candidate: MemoryCandidate }>;
  /** Superseded memories switched off rather than deleted. */
  deactivates: string[];
  skipped: number;
}

/**
 * Decides what to do with each candidate against what is already stored.
 * Pure function — easy to test, no database access.
 */
export function planMemoryChanges(input: {
  candidates: MemoryCandidate[];
  existing: UserMemory[];
  minConfidence: number;
  minImportance: number;
  duplicateThreshold: number;
  maxPerRun: number;
}): MemoryPlan {
  const plan: MemoryPlan = { creates: [], updates: [], deactivates: [], skipped: 0 };
  // Candidates accepted in this run also count as "existing" for later ones.
  const pool = [...input.existing];
  const accepted = new Set<string>();

  for (const candidate of input.candidates) {
    if (plan.creates.length + plan.updates.length >= input.maxPerRun) {
      plan.skipped += 1;
      continue;
    }
    if (candidate.confidence < input.minConfidence || candidate.importance < input.minImportance) {
      plan.skipped += 1;
      continue;
    }

    // Explicit supersede: the model named the memory this replaces.
    const superseded = candidate.replaces
      ? findSimilarMemory(candidate.replaces, pool, input.duplicateThreshold)
      : null;
    if (superseded && !accepted.has(superseded.id)) {
      plan.updates.push({ id: superseded.id, candidate });
      accepted.add(superseded.id);
      continue;
    }

    const duplicate = findSimilarMemory(candidate.content, pool, input.duplicateThreshold);
    if (duplicate) {
      if (accepted.has(duplicate.id)) {
        plan.skipped += 1;
        continue;
      }
      // Keep the stored memory; only lift its importance when the new signal
      // is stronger. Never create a second phrasing of the same fact.
      if (candidate.importance > duplicate.importance) {
        plan.updates.push({
          id: duplicate.id,
          candidate: { ...candidate, content: duplicate.content },
        });
        accepted.add(duplicate.id);
      } else {
        plan.skipped += 1;
      }
      continue;
    }

    plan.creates.push(candidate);
    pool.push({
      id: `pending-${plan.creates.length}`,
      content: candidate.content,
      importance: candidate.importance,
    } as UserMemory);
  }

  return plan;
}

/* ------------------------------------------------------------------ Trigger */

/**
 * Explicit "remember this" phrasings. When the user directly asks for something
 * to be stored, waiting for `triggerMessages` unanalysed turns would silently
 * lose the instruction — that was the root cause of memories never appearing in
 * a short conversation. Detection is deterministic; the model still decides
 * WHAT (if anything) is durable.
 */
const EXPLICIT_MEMORY_PATTERNS: RegExp[] = [
  /\bremember\b/i,
  /\bkeep (?:that |this )?in mind\b/i,
  /\b(?:don'?t|do not) forget\b/i,
  /\bmake a note\b/i,
  /\bnote that\b/i,
  /\bfor (?:future|later) reference\b/i,
  /\bsave (?:that|this) (?:to|in) (?:your )?memory\b/i,
  /\bfrom now on\b/i,
  /\balways\b.*\b(?:answer|reply|respond|use|call me)\b/i,
  // German — the product is used in a DACH context.
  /\bmerk(?:e)? dir\b/i,
  /\bmerken\b/i,
  /\bnicht vergessen\b/i,
  /\bab (?:jetzt|sofort)\b/i,
];

/** True when the user explicitly asked JARVIS to remember something. */
export function detectExplicitMemoryRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Configurable trigger. Normally extraction runs once a conversation has
 * produced at least `triggerMessages` unanalysed turns — never after every
 * message. An explicit user request bypasses that threshold so a directly
 * stated durable fact is persisted immediately.
 */
export function shouldExtractMemories(input: {
  unanalysedMessages: number;
  config: ContextConfig;
  explicitRequest?: boolean;
}): boolean {
  if (!input.config.memory.enabled || !input.config.memory.extraction.enabled) return false;
  if (input.explicitRequest && input.unanalysedMessages > 0) return true;
  return input.unanalysedMessages >= input.config.memory.extraction.triggerMessages;
}

/* ---------------------------------------------------------------- Execution */

function renderTranscript(turns: StoredTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n\n");
}

async function collect(provider: ChatProvider, request: Parameters<ChatProvider["streamChat"]>[0]) {
  let text = "";
  for await (const chunk of provider.streamChat(request)) text += chunk.delta;
  return text.trim();
}

export interface ExtractionResult {
  analysedMessages: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  /** Ids of rows actually written — proof of persistence, never assumed. */
  createdIds: string[];
  /** Categories written, for safe server-side observability. */
  categories: string[];
  /** True when a database write failed; the caller logs, the user never sees it. */
  persistenceFailed: boolean;
}

/** Content-free structured log line; ids are truncated, content never logged. */
function logMemoryEvent(event: string, fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ event, ...fields }));
}

/**
 * Full extraction pass for one conversation.
 *
 * Reads only messages newer than the conversation's extraction bookmark, asks
 * the model for candidates, reconciles them against the user's existing
 * memories, writes the result and moves the bookmark forward.
 *
 * Callers MUST treat failure as non-fatal: a failed pass leaves the bookmark
 * untouched, so the next turn simply tries again.
 */
export async function extractMemoriesFromConversation(input: {
  supabase: SupabaseClient;
  provider: ChatProvider;
  config: ContextConfig;
  conversationId: string;
  userId: string;
  /** Bookmark from the conversation row; only newer messages are analysed. */
  extractedThrough?: string | null;
  /** The user explicitly asked for something to be remembered in this excerpt. */
  explicitRequest?: boolean;
}): Promise<ExtractionResult> {
  const { supabase, provider, config, conversationId, userId } = input;
  const settings = config.memory.extraction;
  const empty: ExtractionResult = {
    analysedMessages: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    createdIds: [],
    categories: [],
    persistenceFailed: false,
  };

  let query = supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId);
  if (input.extractedThrough) query = query.gt("created_at", input.extractedThrough);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(settings.maxSourceMessages)
    .returns<Array<{ role: StoredTurn["role"]; content: string; created_at: string }>>();

  if (error) throw new MemoryExtractionError("Could not load the conversation for extraction.");

  const rows = (data ?? []).filter((row) => row.role === "user" || row.role === "assistant");
  if (!rows.length) return empty;

  let transcript = renderTranscript(rows);
  if (transcript.length > settings.maxSourceCharacters) {
    transcript = transcript.slice(-settings.maxSourceCharacters);
  }

  // Existing memories are sent so the model can avoid duplicates and mark
  // outdated ones. Only this user's active memories are ever loaded.
  const { data: existingRows } = await supabase
    .from("user_memories")
    .select("id, user_id, content, category, importance, is_active, updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("importance", { ascending: false })
    .limit(settings.maxExistingMemories);

  const existing = (existingRows ?? []) as UserMemory[];
  const existingBlock = existing.length
    ? `Existing memories about this user:\n${existing.map((m) => `- ${m.content}`).join("\n")}\n\n`
    : "No memories are stored about this user yet.\n\n";

  // When the user literally asked to be remembered on something, say so: the
  // model must not discard an explicit standing instruction as small talk.
  const explicitBlock = input.explicitRequest
    ? "The user explicitly asked the assistant to remember something in this excerpt. Capture that information as a memory if it is durable, and give it importance 4 or 5.\n\n"
    : "";

  let raw: string;
  try {
    raw = await collect(provider, {
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `${existingBlock}${explicitBlock}New conversation excerpt:\n\n${transcript}`,
        },
      ],
      model: settings.model ?? config.summary.model ?? config.model,
      maxOutputTokens: settings.maxOutputTokens,
      temperature: 0,
    });
  } catch {
    throw new MemoryExtractionError("The AI service could not analyse the conversation.");
  }

  const plan = planMemoryChanges({
    candidates: parseCandidates(raw),
    existing,
    minConfidence: settings.minConfidence,
    minImportance: settings.minImportance,
    duplicateThreshold: settings.duplicateThreshold,
    maxPerRun: settings.maxPerRun,
  });

  const result: ExtractionResult = { ...empty, analysedMessages: rows.length, skipped: plan.skipped };

  if (plan.creates.length) {
    // A memory only counts as saved once the database confirms the row, and the
    // returned ids are the proof — never the assistant's own acknowledgement.
    const { data: inserted, error: insertError } = await supabase
      .from("user_memories")
      .insert(
        plan.creates.map((candidate) => ({
          user_id: userId,
          content: candidate.content,
          category: candidate.category,
          importance: candidate.importance,
          confidence: candidate.confidence,
          source: input.explicitRequest ? "user" : "assistant",
          source_conversation_id: conversationId,
          metadata: { extracted: true, explicit: Boolean(input.explicitRequest) },
        })),
      )
      .select("id, category");

    if (insertError) {
      result.persistenceFailed = true;
    } else {
      const rowsInserted = (inserted ?? []) as Array<{ id: string; category: string }>;
      result.created = rowsInserted.length;
      result.createdIds = rowsInserted.map((row) => row.id);
      result.categories = rowsInserted.map((row) => row.category);
      // An insert that silently stored nothing (e.g. RLS) must not look like success.
      if (!rowsInserted.length) result.persistenceFailed = true;
    }
  }

  for (const update of plan.updates) {
    const { error: updateError } = await supabase
      .from("user_memories")
      .update({
        content: update.candidate.content,
        category: update.candidate.category,
        importance: update.candidate.importance,
        confidence: update.candidate.confidence,
      })
      .eq("id", update.id)
      .eq("user_id", userId);
    if (updateError) result.persistenceFailed = true;
    else result.updated += 1;
  }

  if (plan.deactivates.length) {
    const { error: deactivateError } = await supabase
      .from("user_memories")
      .update({ is_active: false })
      .eq("user_id", userId)
      .in("id", plan.deactivates);
    if (deactivateError) result.persistenceFailed = true;
    else result.deactivated = plan.deactivates.length;
  }

  // Move the bookmark only after a pass that persisted everything it planned;
  // otherwise the next turn re-analyses the same excerpt and tries again.
  if (!result.persistenceFailed) {
    const lastRow = rows[rows.length - 1]!;
    await supabase
      .from("conversations")
      .update({ memory_extracted_through: lastRow.created_at })
      .eq("id", conversationId)
      .eq("user_id", userId);
  }

  logMemoryEvent("memory.extraction.completed", {
    userId: userId.slice(0, 8),
    conversationId: conversationId.slice(0, 8),
    explicitRequest: Boolean(input.explicitRequest),
    analysedMessages: result.analysedMessages,
    created: result.created,
    updated: result.updated,
    deactivated: result.deactivated,
    skipped: result.skipped,
    persistenceFailed: result.persistenceFailed,
    memoryIds: result.createdIds.map((id) => id.slice(0, 8)),
    categories: result.categories,
  });

  return result;
}
