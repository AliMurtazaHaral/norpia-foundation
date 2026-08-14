/**
 * AI Layer — provider registry.
 *
 * Week 2 registers declarative placeholders only; calling them throws
 * NOT_IMPLEMENTED. Week 4 replaces the placeholder with a real client.
 */

import { notImplemented } from "../core/errors";
import type { AiProvider, AiProviderDescriptor } from "./ai-provider";

function plannedProvider(
  id: string,
  label: string,
  capabilities: AiProvider["capabilities"],
): AiProvider {
  return {
    id,
    label,
    capabilities,
    isConfigured: () => false,
    async complete() {
      throw notImplemented(`AI provider "${id}" is not implemented yet (planned for Week 4).`);
    },
  };
}

const providers = new Map<string, AiProvider>([

  ["openai", plannedProvider("openai", "OpenAI", ["chat", "embedding", "image", "speech-to-text"])],
  ["anthropic", plannedProvider("anthropic", "Anthropic", ["chat"])],
]);

export function registerAiProvider(provider: AiProvider): void {
  providers.set(provider.id, provider);
}

export function getAiProvider(id: string): AiProvider | undefined {
  return providers.get(id);
}

export function listAiProviders(): AiProviderDescriptor[] {
  return [...providers.values()].map((p) => ({
    id: p.id,
    label: p.label,
    capabilities: p.capabilities,
    status: p.isConfigured() ? "configured" : "planned",
  }));
}
