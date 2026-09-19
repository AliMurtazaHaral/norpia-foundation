/**
 * Month 2 — Week 3: provider registry.
 *
 * Adding a provider = implement `AiProviderAdapter`, register it here, add its
 * settings in `provider-config.ts`. No call site in NORPIA changes.
 */

import { anthropicAdapter } from "@/backend/ai/provider/anthropic-adapter";
import { openAiAdapter } from "@/backend/ai/provider/openai-adapter";
import {
  getActiveProviderId,
  listProviderSettings,
} from "@/backend/ai/provider/provider-config";
import {
  AiProviderError,
  type AiProviderAdapter,
  type AiProviderDescriptor,
  type AiProviderId,
} from "@/backend/ai/provider/provider-types";

const adapters = new Map<AiProviderId, AiProviderAdapter>([
  [openAiAdapter.id, openAiAdapter],
  [anthropicAdapter.id, anthropicAdapter],
]);

export function registerProviderAdapter(adapter: AiProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getProviderAdapter(id: AiProviderId): AiProviderAdapter | undefined {
  return adapters.get(id);
}

/** Resolves an adapter or fails with a normalised, user-safe error. */
export function resolveProvider(id?: AiProviderId): AiProviderAdapter {
  const providerId = id ?? getActiveProviderId();
  const adapter = adapters.get(providerId);
  if (!adapter) {
    throw AiProviderError.of("provider_unavailable", {
      provider: providerId,
      message: "The selected AI provider is not available.",
    });
  }
  return adapter;
}

/** Configuration view used by the /api/v1/ai/providers endpoint. */
export function listProviders(): AiProviderDescriptor[] {
  const active = getActiveProviderId();
  return listProviderSettings().map((settings) => {
    const adapter = adapters.get(settings.id);
    const available = Boolean(adapter?.isConfigured());
    return {
      id: settings.id,
      label: settings.label,
      available,
      defaultModel: settings.defaultModel,
      models: settings.models,
      status: settings.id === active ? "active" : available ? "configured" : "planned",
    };
  });
}
