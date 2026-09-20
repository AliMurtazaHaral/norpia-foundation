/**
 * Month 2 — Week 3: centralised AI provider configuration (Task 5).
 *
 * Single source of truth for the active provider, the default model per
 * provider and the models a provider is allowed to serve. Everything is read
 * from server-side environment variables at call time; no key ever reaches the
 * frontend and no key value is stored or logged here.
 */

import { listModelIds } from "@/backend/ai/provider/model-catalog";
import type { AiProviderId } from "@/backend/ai/provider/provider-types";

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export interface ProviderSettings {
  id: AiProviderId;
  label: string;
  /** Name of the server-side env var holding the credential. */
  apiKeyEnv: string;
  defaultModel: string;
  models: string[];
}

const PROVIDER_SETTINGS: Record<string, ProviderSettings> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: listModelIds("openai"),
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-latest",
    models: listModelIds("anthropic"),
  },
};

export function getProviderSettings(id: AiProviderId): ProviderSettings | undefined {
  return PROVIDER_SETTINGS[id];
}

export function listProviderSettings(): ProviderSettings[] {
  return Object.values(PROVIDER_SETTINGS);
}

/** True when the provider's credential is present in the server environment. */
export function hasCredential(id: AiProviderId): boolean {
  const settings = PROVIDER_SETTINGS[id];
  return Boolean(settings && env(settings.apiKeyEnv)?.trim());
}

/**
 * The provider JARVIS talks to. `AI_PROVIDER` overrides it; OpenAI stays the
 * default so existing deployments keep behaving exactly as before.
 */
export function getActiveProviderId(): AiProviderId {
  const configured = env("AI_PROVIDER")?.trim().toLowerCase();
  return configured && configured in PROVIDER_SETTINGS ? configured : "openai";
}

/** Default model for a provider; `AI_MODEL` still wins for the active one. */
export function getDefaultModel(id: AiProviderId): string {
  const settings = PROVIDER_SETTINGS[id];
  if (id === getActiveProviderId()) {
    const override = env("AI_MODEL")?.trim();
    if (override) return override;
  }
  return settings?.defaultModel ?? "gpt-4o-mini";
}
