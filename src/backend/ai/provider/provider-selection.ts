/**
 * Month 2 — Week 3 (Prompt 2): provider / model selection.
 *
 * Deliberately simple and explicit (Task 4):
 *   1. an explicit request wins (provider and/or model)
 *   2. otherwise the configured active provider and its default model
 *   3. a model always resolves to the provider that actually serves it
 *
 * No autonomous routing, no scoring, no fallback chains — those belong to a
 * later orchestration week.
 */

import {
  getActiveProviderId,
  getDefaultModel,
  hasCredential,
} from "@/backend/ai/provider/provider-config";
import { getModelDefinition, listModels } from "@/backend/ai/provider/model-catalog";
import type { AiProviderId } from "@/backend/ai/provider/provider-types";

export interface SelectionRequest {
  provider?: AiProviderId;
  model?: string;
}

export interface Selection {
  provider: AiProviderId;
  model: string;
  /** Why this pairing was chosen — useful in logs, never shown to users. */
  reason: "explicit-model" | "explicit-provider" | "configured-default";
}

export function selectProviderAndModel(request: SelectionRequest = {}): Selection {
  // An explicitly named model decides the provider, so a caller can never pair
  // a Claude model with the OpenAI adapter by accident.
  if (request.model) {
    const definition = getModelDefinition(request.model);
    if (definition) {
      return {
        provider: request.provider ?? definition.provider,
        model: definition.id,
        reason: "explicit-model",
      };
    }
    // Unknown model id (e.g. a brand-new model set via AI_MODEL): trust it, but
    // keep it on the requested or configured provider.
    return {
      provider: request.provider ?? getActiveProviderId(),
      model: request.model,
      reason: "explicit-model",
    };
  }

  if (request.provider) {
    return {
      provider: request.provider,
      model: getDefaultModel(request.provider),
      reason: "explicit-provider",
    };
  }

  const provider = getActiveProviderId();
  return { provider, model: getDefaultModel(provider), reason: "configured-default" };
}

/** Models a provider serves that are usable right now (credential present). */
export function listSelectableModels(provider: AiProviderId) {
  const available = hasCredential(provider);
  return listModels(provider).map((model) => ({ ...model, available }));
}
