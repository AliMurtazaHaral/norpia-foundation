/**
 * Browser-side bridge to the JARVIS streaming endpoint.
 * The OpenAI key lives only on the server; this only sends the Supabase token.
 */

import { appConfig } from "@/lib/config";
import { supabase } from "@/lib/supabase/client";

export interface StreamAssistantOptions {
  conversationId: string;
  message: string;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

export async function streamAssistantReply(options: StreamAssistantOptions): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(`${appConfig.apiBaseUrl}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(options.signal ? { signal: options.signal } : {}),
    body: JSON.stringify({
      conversation_id: options.conversationId,
      message: options.message,
    }),
  });

  if (!response.ok) {
    let message = "JARVIS could not answer right now. Please try again.";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }

  if (!response.body) throw new Error("JARVIS returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (!text) continue;
    full += text;
    options.onDelta(full);
  }

  return full;
}
