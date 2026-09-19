/**
 * Compatibility shim — the OpenAI implementation moved to
 * `src/backend/ai/provider/openai-adapter.ts` in Month 2 Week 3.
 *
 * New code should call the NORPIA AI layer (`@/backend/ai/ai-service`) instead
 * of resolving a provider directly.
 */

import { openAiAdapter } from "@/backend/ai/provider/openai-adapter";
import { resolveProvider } from "@/backend/ai/provider/provider-registry";

import type { ChatProvider } from "@/backend/ai/chat-provider";

export const openAiProvider: ChatProvider = openAiAdapter;

export function resolveChatProvider(provider: string): ChatProvider {
  const adapter = resolveProvider(provider);
  // Week 3: providers exist in the registry before their adapter is implemented.
  // Selecting one that cannot serve traffic must fail here, exactly as before.
  if (!adapter.isConfigured() && adapter.id !== "openai") {
    throw new Error("The selected AI provider is not available.");
  }
  return adapter;
}
