/**
 * Month 2 — Week 3 (Prompt 3), Tasks 3/4/6: orchestration configuration.
 *
 * Every routing decision NORPIA can make is described here, server-side, from
 * environment variables. There is no autonomous optimisation: an operator
 * configures a rule, the orchestrator follows it.
 */

import { getActiveProviderId, hasCredential } from "@/backend/ai/provider/provider-config";
import { getModelDefinition } from "@/backend/ai/provider/model-catalog";
import { AI_TASK_TYPES, type AiTaskType } from "@/backend/ai/orchestration/task-types";
import type { AiProviderId } from "@/backend/ai/provider/provider-types";

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function flag(name: string, fallback: boolean): boolean {
  const raw = env(name)?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Optional per-task model override, e.g. `AI_MODEL_REASONING=gpt-4.1`. */
function taskEnvKey(task: AiTaskType): string {
  return `AI_MODEL_${task.toUpperCase().replace(/-/g, "_")}`;
}

export type CostPreference = "balanced" | "cheapest" | "quality";

export interface FallbackConfig {
  enabled: boolean;
  /**
   * Approved fallback provider. Nothing is ever sent to a provider that is not
   * explicitly configured here AND holds a credential.
   */
  provider?: AiProviderId;
  model?: string;
}

export interface OrchestrationConfig {
  /** Per-task model overrides; unset tasks use the provider default model. */
  taskModels: Partial<Record<AiTaskType, string>>;
  costPreference: CostPreference;
  fallback: FallbackConfig;
  /** Whether a client may name a provider/model at all (default: no). */
  allowClientModelSelection: boolean;
  /**
   * Task → provider routing. Applied only when the target provider holds a
   * credential; otherwise the primary provider handles the task.
   */
  taskProviders: Partial<Record<AiTaskType, AiProviderId>>;
  /** Reserved: send one request to two providers for comparison. Off; not executed. */
  dualProviderComparison: boolean;
}

/**
 * Default task routing (a foundation, not a permanent rule). OpenAI stays the
 * default for everything else. Override per task with `AI_PROVIDER_<TASK>`,
 * or disable all task routing with `AI_TASK_ROUTING=false`.
 */
export const DEFAULT_TASK_PROVIDERS: Partial<Record<AiTaskType, AiProviderId>> = {
  reasoning: "anthropic",
  "document-question": "anthropic",
};

export function getOrchestrationConfig(): OrchestrationConfig {
  const taskModels: Partial<Record<AiTaskType, string>> = {};
  for (const task of AI_TASK_TYPES) {
    const value = env(taskEnvKey(task))?.trim();
    if (value) taskModels[task] = value;
  }

  const taskProviders: Partial<Record<AiTaskType, AiProviderId>> = flag("AI_TASK_ROUTING", true)
    ? { ...DEFAULT_TASK_PROVIDERS }
    : {};
  for (const task of AI_TASK_TYPES) {
    const value = env(`AI_PROVIDER_${task.toUpperCase().replace(/-/g, "_")}`)?.trim().toLowerCase();
    if (value) taskProviders[task] = value;
  }

  const rawPreference = env("AI_COST_PREFERENCE")?.trim().toLowerCase();
  const costPreference: CostPreference =
    rawPreference === "cheapest" || rawPreference === "quality" ? rawPreference : "balanced";

  const fallbackProvider = env("AI_FALLBACK_PROVIDER")?.trim().toLowerCase();
  const fallbackModel = env("AI_FALLBACK_MODEL")?.trim();

  return {
    taskModels,
    costPreference,
    fallback: {
      enabled: flag("AI_FALLBACK_ENABLED", false),
      ...(fallbackProvider ? { provider: fallbackProvider } : {}),
      ...(fallbackModel ? { model: fallbackModel } : {}),
    },
    allowClientModelSelection: flag("AI_ALLOW_CLIENT_MODEL_SELECTION", false),
    taskProviders,
    dualProviderComparison: flag("AI_DUAL_PROVIDER_COMPARISON", false),
  };
}

/**
 * The approved fallback, or undefined. A fallback is only usable when it is
 * enabled, names a provider other than the primary, and that provider actually
 * holds a server-side credential — so no data ever reaches an unapproved vendor.
 */
export function resolveFallback(
  primary: AiProviderId,
  config: OrchestrationConfig = getOrchestrationConfig(),
): { provider: AiProviderId; model?: string } | undefined {
  const { fallback } = config;
  if (!fallback.enabled || !fallback.provider) return undefined;
  if (fallback.provider === primary) return undefined;
  if (!hasCredential(fallback.provider)) return undefined;
  if (fallback.model) {
    const definition = getModelDefinition(fallback.model);
    // A configured model must belong to the configured fallback provider.
    if (definition && definition.provider !== fallback.provider) {
      return { provider: fallback.provider };
    }
  }
  return {
    provider: fallback.provider,
    ...(fallback.model ? { model: fallback.model } : {}),
  };
}

/** The provider JARVIS uses unless a rule says otherwise. OpenAI by default. */
export function getPrimaryProviderId(): AiProviderId {
  return getActiveProviderId();
}
