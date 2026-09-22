/**
 * POST /api/v1/ai/chat — the JARVIS streaming endpoint.
 *
 * Browser → this server route → OpenAI. The browser never sees the API key.
 * The caller is identified from the Supabase access token in the Authorization
 * header; any user_id sent by the client is ignored.
 */

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AiProviderError, type ChatProvider } from "@/backend/ai/chat-provider";
import { orchestrateChatStream } from "@/backend/ai/orchestration/orchestrator";
import { resolveProvider } from "@/backend/ai/provider/provider-registry";
import {
  shouldSummarize,
  summarizeConversation,
  type ConversationSummary,
} from "@/backend/ai/conversation-summary";
import { getContextConfig } from "@/backend/ai/context-config";
import { ContextError, prepareConversationContext, loadOwnedConversation } from "@/backend/ai/conversation-context";
import { estimateTokens } from "@/backend/ai/context-manager";
import { logAiUsage } from "@/backend/ai/usage-log";
import {
  detectExplicitMemoryRequest,
  extractMemoriesFromConversation,
  shouldExtractMemories,
} from "@/backend/memory/memory-extraction";
import { appConfig } from "@/lib/config";


const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.string().trim().min(1).max(32000),
  /** Set by the client when re-sending after a failure, to avoid duplicates. */
  retry: z.boolean().optional(),
});

/** A user message repeated within this window is treated as a duplicate submit. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Best-effort summary maintenance. Any failure is logged (technical detail
 * stays server-side) and swallowed: the conversation keeps working with recent
 * messages only, and the trigger simply fires again on the next turn.
 */
async function maybeSummarize(input: {
  supabase: SupabaseClient;
  provider: ChatProvider;
  config: ReturnType<typeof getContextConfig>;
  conversationId: string;
  userId: string;
  previous: ConversationSummary | null;
}): Promise<void> {
  if (!input.config.summary.enabled) return;
  try {
    const { count, error } = await input.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", input.conversationId);
    if (error || typeof count !== "number") return;

    if (
      !shouldSummarize({
        totalMessages: count,
        summarizedMessages: input.previous?.coveredMessageCount ?? 0,
        config: input.config,
      })
    ) {
      return;
    }

    await summarizeConversation({
      supabase: input.supabase,
      provider: input.provider,
      config: input.config,
      conversationId: input.conversationId,
      userId: input.userId,
      previous: input.previous,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "ai.chat.summary_failed",
        conversationId: input.conversationId.slice(0, 8),
        userId: input.userId.slice(0, 8),
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}

/**
 * Best-effort long-term memory extraction. Runs after the reply is complete,
 * only once enough new turns exist, and never breaks the conversation: on
 * failure the bookmark stays put and the next turn tries again.
 */
async function maybeExtractMemories(input: {
  supabase: SupabaseClient;
  provider: ChatProvider;
  config: ReturnType<typeof getContextConfig>;
  conversationId: string;
  userId: string;
  extractedThrough: string | null;
}): Promise<void> {
  const { config } = input;
  if (!config.memory.enabled || !config.memory.extraction.enabled) return;

  try {
    let countQuery = input.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", input.conversationId);
    if (input.extractedThrough) countQuery = countQuery.gt("created_at", input.extractedThrough);

    const { count, error } = await countQuery;
    if (error || typeof count !== "number") return;
    if (!shouldExtractMemories({ unanalysedMessages: count, config })) return;

    await extractMemoriesFromConversation({
      supabase: input.supabase,
      provider: input.provider,
      config,
      conversationId: input.conversationId,
      userId: input.userId,
      extractedThrough: input.extractedThrough,
    });
  } catch (error) {
    // Technical detail stays server-side; the user never sees memory failures.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "ai.chat.memory_extraction_failed",
        conversationId: input.conversationId.slice(0, 8),
        userId: input.userId.slice(0, 8),
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}

async function handlePost({ request }: { request: Request }): Promise<Response> {
  const config = getContextConfig();
  const startedAt = Date.now();

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return errorResponse("You must be signed in to talk to JARVIS.", 401);

  // Public project URL / anon key only — the service-role key is never used here.
  const supabaseUrl = env("SUPABASE_URL") ?? env("VITE_SUPABASE_URL") ?? appConfig.supabase.url;
  const supabaseKey =
    env("SUPABASE_ANON_KEY") ??
    env("VITE_SUPABASE_ANON_KEY") ??
    appConfig.supabase.anonKey ??
    appConfig.supabase.publishableKey;
  if (!supabaseUrl || !supabaseKey) return errorResponse("Chat is not configured yet.", 503);

  // User-scoped client: every query below is additionally enforced by RLS.
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return errorResponse("Your session has expired. Please sign in again.", 401);

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch {
    return errorResponse("That message could not be sent. Please check your input.", 400);
  }

  if (payload.message.length > config.maxMessageLength) {
    return errorResponse(
      `Your message is too long (limit ${config.maxMessageLength} characters).`,
      413,
    );
  }

  // Ownership check — never trust a conversation id from the client.
  let conversation;
  try {
    conversation = await loadOwnedConversation(supabase, payload.conversation_id, user.id);
  } catch (error) {
    if (error instanceof ContextError) return errorResponse(error.message, error.status);
    return errorResponse("Could not load that conversation.", 500);
  }

  // 1. Persist the user message first, so nothing is lost if the model fails.
  //    Duplicate submissions and retries reuse the message already stored.
  const { data: lastRows } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = lastRows?.[0];
  const isDuplicate =
    Boolean(last) &&
    last!.role === "user" &&
    last!.content === payload.message &&
    Date.now() - new Date(last!.created_at as string).getTime() < DUPLICATE_WINDOW_MS;

  if (!isDuplicate) {
    const { error: userMessageError } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: "user",
      content: payload.message,
    });
    if (userMessageError) return errorResponse("Your message could not be saved.", 500);
  }

  // 2. Prepare the context server-side (ownership + chronology + bounds).
  let prepared;
  try {
    prepared = await prepareConversationContext({
      supabase,
      conversationId: conversation.id,
      userId: user.id,
      config,
      conversation,
    });
  } catch (error) {
    if (error instanceof ContextError) return errorResponse(error.message, error.status);
    return errorResponse("Could not load the conversation history.", 500);
  }

  const { messages, stats } = prepared;
  const encoder = new TextEncoder();
  const estimatedInputTokens = stats.estimatedInputTokens;

  // Month 2 Week 3: the route no longer knows which vendor answers. It asks the
  // NORPIA orchestration layer, which classifies the request, selects a model,
  // applies the approved fallback and resolves the provider adapter.
  let handle: Awaited<ReturnType<typeof orchestrateChatStream>>;
  let provider: ChatProvider;
  try {
    handle = await orchestrateChatStream({
      messages,
      classifyText: payload.message,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      metadata: { feature: "jarvis.chat", promptVersion: stats.promptVersion },
    });
    // Same adapter, reused for the best-effort maintenance passes below.
    provider = resolveProvider(handle.provider);
  } catch (error) {
    const message =
      error instanceof AiProviderError
        ? error.message
        : "JARVIS could not answer right now. Please try again.";
    logAiUsage({
      conversationId: conversation.id,
      userId: user.id,
      provider: "unavailable",
      model: config.model,
      promptVersion: stats.promptVersion,
      historyMessages: stats.historyMessages,
      droppedMessages: stats.droppedMessages,
      estimatedInputTokens,
      estimatedOutputTokens: 0,
      durationMs: Date.now() - startedAt,
      status: "interrupted",
    });
    return errorResponse(message, error instanceof AiProviderError ? error.status : 502);
  }

  const model = handle.model;
  const iterator = handle.stream[Symbol.asyncIterator]();
  // The orchestrator already primed the upstream call, so a provider failure
  // became an HTTP error above instead of a silent 200 with no reply.
  const firstChunk: IteratorResult<{ delta: string }> = {
    done: false,
    value: { delta: "" },
  } as IteratorResult<{ delta: string }>;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let status: "completed" | "interrupted" | "empty" = "completed";
      try {
        let result = firstChunk;
        while (!result.done) {
          full += result.value.delta;
          controller.enqueue(encoder.encode(result.value.delta));
          result = await iterator.next();
        }


        if (!full.trim()) {
          status = "empty";
          controller.enqueue(
            encoder.encode("\n\n[JARVIS returned an empty response. Please try again.]"),
          );
        } else {
          // 3. Persist the completed assistant message exactly once.
          await supabase.from("messages").insert({
            conversation_id: conversation.id,
            user_id: user.id,
            role: "assistant",
            content: full,
            metadata: {
              provider: provider.id,
              model,
              task: handle.classification.task,
              used_fallback: handle.usedFallback,
              prompt_version: stats.promptVersion,
              context_messages: stats.historyMessages,
              summary_version: stats.summaryVersion,
            },
          });

          // 4. Maintenance: refresh the rolling summary when the conversation
          //    has grown past the trigger. Never blocks or breaks the reply —
          //    on failure the next turn simply uses recent messages only.
          await maybeSummarize({
            supabase,
            provider,
            config,
            conversationId: conversation.id,
            userId: user.id,
            previous: prepared.summary,
          });

          // 5. Maintenance: learn durable facts about the user from the new
          //    turns. Also best-effort and invisible to the reply.
          await maybeExtractMemories({
            supabase,
            provider,
            config,
            conversationId: conversation.id,
            userId: user.id,
            extractedThrough: conversation.memory_extracted_through ?? null,
          });
        }
      } catch (error) {
        status = "interrupted";
        const message =
          error instanceof AiProviderError
            ? error.message
            : "JARVIS could not complete that response. Please try again.";
        controller.enqueue(encoder.encode(`\n\n[${message}]`));
        if (full.trim()) {
          await supabase.from("messages").insert({
            conversation_id: conversation.id,
            user_id: user.id,
            role: "assistant",
            content: `${full}\n\n[${message}]`,
            metadata: {
              provider: provider.id,
              model,
              prompt_version: stats.promptVersion,
              interrupted: true,
            },
          });
        }
      } finally {
        // Provider-reported usage when the adapter supplied it; estimates otherwise.
        const usage = handle.getUsage();
        const telemetry = handle.getTelemetry();
        logAiUsage({
          conversationId: conversation.id,
          userId: user.id,
          provider: provider.id,
          model,
          task: telemetry.task,
          usedFallback: telemetry.usedFallback,
          ...(telemetry.errorCode ? { errorCode: telemetry.errorCode } : {}),
          promptVersion: stats.promptVersion,
          historyMessages: stats.historyMessages,
          droppedMessages: stats.droppedMessages,
          estimatedInputTokens: usage?.inputTokens ?? estimatedInputTokens,
          estimatedOutputTokens: usage?.outputTokens ?? estimateTokens(full),
          ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
          ...(usage?.estimatedCostUsd !== undefined
            ? { estimatedCostUsd: usage.estimatedCostUsd }
            : {}),
          usageReported: usage ? !usage.estimated : false,
          durationMs: Date.now() - startedAt,
          status,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export const Route = createFileRoute("/api/v1/ai/chat")({
  server: { handlers: { POST: handlePost } },
});
