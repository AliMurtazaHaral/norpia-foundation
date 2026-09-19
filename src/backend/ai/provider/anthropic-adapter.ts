/**
 * Month 2 — Week 3: Anthropic (Claude) placeholder adapter.
 *
 * Registered so the provider is visible in configuration and can be selected
 * once the integration lands (Month 2 Week 4+). It performs NO API calls: the
 * Claude integration itself is explicitly out of scope for Week 3.
 *
 * Implementing Claude later means filling in `streamChat` here — nothing else
 * in NORPIA changes.
 */

import {
  AiProviderError,
  type AiProviderAdapter,
  type AiStreamChunk,
  type ResolvedAiChatRequest,
} from "@/backend/ai/provider/provider-types";
import { getProviderSettings } from "@/backend/ai/provider/provider-config";

export const anthropicAdapter: AiProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",

  // Reported as not configured until the adapter is actually implemented,
  // so it can never silently become the active provider.
  isConfigured: () => false,

  describe() {
    const settings = getProviderSettings("anthropic")!;
    return {
      id: settings.id,
      label: settings.label,
      available: false,
      defaultModel: settings.defaultModel,
      models: settings.models,
    };
  },

  // eslint-disable-next-line require-yield
  async *streamChat(_request: ResolvedAiChatRequest): AsyncGenerator<AiStreamChunk> {
    throw AiProviderError.of("provider_unavailable", {
      provider: "anthropic",
      message: "That AI provider is not available yet.",
    });
  },
};
