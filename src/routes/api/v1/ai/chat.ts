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

import { AiProviderError } from "@/backend/ai/chat-provider";
import { getAiModelConfig, JARVIS_SYSTEM_PROMPT } from "@/backend/ai/jarvis-prompt";
import { resolveChatProvider } from "@/backend/ai/openai-provider";
import { appConfig } from "@/lib/config";

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.string().trim().min(1).max(32000),
});

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePost({ request }: { request: Request }): Promise<Response> {
  const config = getAiModelConfig();

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
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, user_id")
    .eq("id", payload.conversation_id)
    .maybeSingle();
  if (conversationError) return errorResponse("Could not load that conversation.", 500);
  if (!conversation || conversation.user_id !== user.id) {
    return errorResponse("That conversation could not be found.", 404);
  }

  // 1. Persist the user message first, so nothing is lost if the model fails.
  const { error: userMessageError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    user_id: user.id,
    role: "user",
    content: payload.message,
  });
  if (userMessageError) return errorResponse("Your message could not be saved.", 500);

  // 2. Build a bounded context window (cost control).
  const { data: history, error: historyError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(config.maxHistoryMessages);
  if (historyError) return errorResponse("Could not load the conversation history.", 500);

  const turns = (history ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

  const messages = [{ role: "system" as const, content: JARVIS_SYSTEM_PROMPT }, ...turns];

  const provider = resolveChatProvider(config.provider);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of provider.streamChat({
          messages,
          model: config.model,
          maxOutputTokens: config.maxOutputTokens,
          temperature: config.temperature,
        })) {
          full += chunk.delta;
          controller.enqueue(encoder.encode(chunk.delta));
        }

        if (!full.trim()) {
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
            metadata: { provider: provider.id, model: config.model },
          });
        }
      } catch (error) {
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
            metadata: { provider: provider.id, model: config.model, interrupted: true },
          });
        }
      } finally {
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
