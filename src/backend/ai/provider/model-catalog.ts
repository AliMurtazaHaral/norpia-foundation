/**
 * Month 2 — Week 3 (Prompt 2): centralised model catalogue.
 *
 * ONE place describes every model NORPIA may talk to: which provider serves it,
 * what it can do, how much context it holds, how it is configured by default
 * and what it costs. Nothing else in the application hardcodes model facts.
 *
 * Adding a model = adding an entry here. Adding a provider = an adapter plus
 * its entries here and in `provider-config.ts`.
 */

import type { AiProviderId } from "@/backend/ai/provider/provider-types";

/**
 * Capability foundation (Task 3). Descriptive only — the orchestration that
 * consumes these lands in a later roadmap week. No tool execution here.
 */
export type ModelCapability =
  | "text"
  | "reasoning"
  | "long-context"
  | "structured-output"
  | "tools"
  | "vision"
  | "streaming";

export interface ModelCost {
  /** USD per 1M tokens, provider list price. Indicative, not billing-grade. */
  inputPerMillion: number;
  outputPerMillion: number;
  currency: "USD";
}

export interface ModelDefinition {
  id: string;
  provider: AiProviderId;
  label: string;
  capabilities: ModelCapability[];
  /** Total context window in tokens. */
  contextWindow: number;
  /** Provider-enforced ceiling on a single generation. */
  maxOutputTokens: number;
  /** Suggested default temperature when the caller does not set one. */
  defaultTemperature?: number;
  cost?: ModelCost;
  /** Set when a model is kept for compatibility but should not be chosen. */
  deprecated?: boolean;
}

const MODELS: ModelDefinition[] = [
  /* ---------------------------------------------------------- OpenAI */
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    capabilities: ["text", "structured-output", "tools", "vision", "streaming"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: "USD" },
  },
  {
    id: "gpt-4o",
    provider: "openai",
    label: "GPT-4o",
    capabilities: ["text", "reasoning", "structured-output", "tools", "vision", "streaming"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 2.5, outputPerMillion: 10, currency: "USD" },
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 mini",
    capabilities: ["text", "long-context", "structured-output", "tools", "vision", "streaming"],
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 0.4, outputPerMillion: 1.6, currency: "USD" },
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    capabilities: [
      "text",
      "reasoning",
      "long-context",
      "structured-output",
      "tools",
      "vision",
      "streaming",
    ],
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 2, outputPerMillion: 8, currency: "USD" },
  },

  /* ------------------------------------------------------- Anthropic */
  {
    id: "claude-3-5-sonnet-latest",
    provider: "anthropic",
    label: "Claude 3.5 Sonnet",
    capabilities: ["text", "reasoning", "long-context", "structured-output", "tools", "vision", "streaming"],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 3, outputPerMillion: 15, currency: "USD" },
  },
  {
    id: "claude-3-5-haiku-latest",
    provider: "anthropic",
    label: "Claude 3.5 Haiku",
    capabilities: ["text", "long-context", "structured-output", "tools", "streaming"],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    defaultTemperature: 0.4,
    cost: { inputPerMillion: 0.8, outputPerMillion: 4, currency: "USD" },
  },
];

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

export function getModelDefinition(modelId: string): ModelDefinition | undefined {
  return BY_ID.get(modelId);
}

export function listModels(provider?: AiProviderId): ModelDefinition[] {
  return provider ? MODELS.filter((model) => model.provider === provider) : [...MODELS];
}

export function listModelIds(provider: AiProviderId): string[] {
  return listModels(provider)
    .filter((model) => !model.deprecated)
    .map((model) => model.id);
}

export function modelSupports(modelId: string, capability: ModelCapability): boolean {
  return getModelDefinition(modelId)?.capabilities.includes(capability) ?? false;
}

/** Context window for a model, or a conservative fallback for unknown ids. */
export function getContextWindow(modelId: string, fallback = 128_000): number {
  return getModelDefinition(modelId)?.contextWindow ?? fallback;
}

/** Clamps a requested output budget to what the model actually allows. */
export function clampOutputTokens(modelId: string, requested: number): number {
  const ceiling = getModelDefinition(modelId)?.maxOutputTokens;
  if (!ceiling) return requested;
  return Math.max(1, Math.min(requested, ceiling));
}

/**
 * Indicative cost in USD for a call. Returns undefined when the model has no
 * published pricing or token counts are unknown — never a guessed number.
 */
export function estimateCostUsd(
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number },
): number | undefined {
  const cost = getModelDefinition(modelId)?.cost;
  if (!cost) return undefined;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined;
  const input = ((usage.inputTokens ?? 0) / 1_000_000) * cost.inputPerMillion;
  const output = ((usage.outputTokens ?? 0) / 1_000_000) * cost.outputPerMillion;
  return Number((input + output).toFixed(6));
}
