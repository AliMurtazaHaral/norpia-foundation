/**
 * Month 2 — Week 1: centralized context configuration.
 *
 * Single source of truth for every value that controls HOW MUCH context is
 * sent to the model. Nothing in the codebase should hard-code these numbers;
 * they are read from the environment at call time (worker runtimes inject env
 * per request) and merged with model-specific limits.
 *
 * Extension points for later phases (summarisation, long-term memory, RAG) are
 * declared here as fields, not as behaviour.
 */

import { getAiModelConfig, type AiModelConfig } from "@/backend/ai/jarvis-prompt";

/**
 * Model-specific context windows (input tokens we are willing to spend).
 * Conservative on purpose: the aim is cost control, not filling the window.
 */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o-mini": 24000,
  "gpt-4o": 24000,
  "gpt-4.1-mini": 24000,
  "gpt-4.1": 32000,
};

const DEFAULT_MODEL_CONTEXT_LIMIT = 16000;

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function positiveNumber(names: string[], fallback: number): number {
  for (const name of names) {
    const parsed = Number(env(name));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export interface SummaryConfig {
  /** SUMMARY_ENABLED=false turns summarisation off entirely. */
  enabled: boolean;
  /** Unsummarised message count that triggers a (re)summarisation. */
  triggerMessages: number;
  /** Newest messages that always stay verbatim, never folded into the summary. */
  keepRecentMessages: number;
  /** Cost guard on the transcript handed to the summariser. */
  maxSourceCharacters: number;
  /** Cost guard on the summary itself. */
  maxOutputTokens: number;
  /** Optional cheaper model for summarisation; defaults to the chat model. */
  model?: string;
}

export interface ContextConfig extends AiModelConfig {
  /** Hard ceiling on estimated input tokens for one request. */
  maxInputTokens: number;
  /** Month 2 Week 1 — conversation-level summarisation. */
  summary: SummaryConfig;
  /** Reserved for future phases — declared, not implemented yet. */
  future: {
    /** Conversation summarisation ships in Week 1; see `summary` above. */
    summarisationEnabled: boolean;
    longTermMemoryEnabled: false;
    retrievalEnabled: false;
  };
}

/**
 * Resolves the effective context configuration:
 *   MAX_INPUT_TOKENS  → explicit override
 *   model limit       → per-model default
 *   DEFAULT           → conservative fallback
 */
export function getContextConfig(): ContextConfig {
  const model = getAiModelConfig();
  const modelLimit = MODEL_CONTEXT_LIMITS[model.model] ?? DEFAULT_MODEL_CONTEXT_LIMIT;

  return {
    ...model,
    maxInputTokens: positiveNumber(["MAX_INPUT_TOKENS", "AI_MAX_INPUT_TOKENS"], modelLimit),
    future: {
      summarisationEnabled: false,
      longTermMemoryEnabled: false,
      retrievalEnabled: false,
    },
  };
}

export function getModelContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_MODEL_CONTEXT_LIMIT;
}
