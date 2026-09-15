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

export interface MemoryExtractionConfig {
  /** MEMORY_EXTRACTION_ENABLED=false stops automatic extraction. */
  enabled: boolean;
  /** Unanalysed messages needed before a pass runs. Never every message. */
  triggerMessages: number;
  /** Hard bound on rows read for one pass. */
  maxSourceMessages: number;
  /** Cost guard on the transcript handed to the extractor. */
  maxSourceCharacters: number;
  /** Existing memories shown to the extractor for duplicate awareness. */
  maxExistingMemories: number;
  /** Cost guard on the extractor's own answer. */
  maxOutputTokens: number;
  /** Candidates below this confidence are discarded. */
  minConfidence: number;
  /** Candidates below this importance are discarded. */
  minImportance: number;
  /** Word-overlap score at which two memories count as the same fact. */
  duplicateThreshold: number;
  /** Maximum writes performed by one pass. */
  maxPerRun: number;
  /** Optional cheaper model; defaults to the summary/chat model. */
  model?: string;
}

export interface MemoryConfig {
  /** MEMORY_ENABLED=false stops memories from entering the model context. */
  enabled: boolean;
  /** How many memories may be injected into one request. */
  maxMemories: number;
  /** Character budget for the whole memory block. */
  maxCharacters: number;
  /** Month 2 Week 2 (Prompt 2) — automatic extraction from conversations. */
  extraction: MemoryExtractionConfig;
}

export interface ContextConfig extends AiModelConfig {
  /** Hard ceiling on estimated input tokens for one request. */
  maxInputTokens: number;
  /** Month 2 Week 1 — conversation-level summarisation. */
  summary: SummaryConfig;
  /** Month 2 Week 2 — cross-conversation long-term memory. */
  memory: MemoryConfig;
  /** Reserved for future phases — declared, not implemented yet. */
  future: {
    /** Conversation summarisation ships in Week 1; see `summary` above. */
    summarisationEnabled: boolean;
    /** Long-term memory ships in Week 2; see `memory` above. */
    longTermMemoryEnabled: boolean;
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

  const summaryEnabled = env("SUMMARY_ENABLED") !== "false";
  const summaryModel = env("SUMMARY_MODEL");
  const memoryEnabled = env("MEMORY_ENABLED") !== "false";
  const extractionModel = env("MEMORY_EXTRACTION_MODEL");

  return {
    ...model,
    maxInputTokens: positiveNumber(["MAX_INPUT_TOKENS", "AI_MAX_INPUT_TOKENS"], modelLimit),
    summary: {
      enabled: summaryEnabled,
      triggerMessages: positiveNumber(["SUMMARY_TRIGGER_MESSAGES"], 24),
      keepRecentMessages: positiveNumber(["SUMMARY_KEEP_RECENT_MESSAGES"], 10),
      maxSourceCharacters: positiveNumber(["SUMMARY_MAX_SOURCE_CHARACTERS"], 24000),
      maxOutputTokens: positiveNumber(["SUMMARY_MAX_OUTPUT_TOKENS"], 400),
      ...(summaryModel ? { model: summaryModel } : {}),
    },
    memory: {
      enabled: memoryEnabled,
      maxMemories: positiveNumber(["MEMORY_MAX_ITEMS"], 12),
      maxCharacters: positiveNumber(["MEMORY_MAX_CHARACTERS"], 2000),
      extraction: {
        enabled: memoryEnabled && env("MEMORY_EXTRACTION_ENABLED") !== "false",
        triggerMessages: positiveNumber(["MEMORY_EXTRACTION_TRIGGER_MESSAGES"], 6),
        maxSourceMessages: positiveNumber(["MEMORY_EXTRACTION_MAX_SOURCE_MESSAGES"], 40),
        maxSourceCharacters: positiveNumber(["MEMORY_EXTRACTION_MAX_SOURCE_CHARACTERS"], 12000),
        maxExistingMemories: positiveNumber(["MEMORY_EXTRACTION_MAX_EXISTING"], 40),
        maxOutputTokens: positiveNumber(["MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS"], 500),
        minConfidence: positiveNumber(["MEMORY_MIN_CONFIDENCE"], 0.6),
        minImportance: positiveNumber(["MEMORY_MIN_IMPORTANCE"], 2),
        duplicateThreshold: positiveNumber(["MEMORY_DUPLICATE_THRESHOLD"], 0.45),
        maxPerRun: positiveNumber(["MEMORY_MAX_PER_RUN"], 5),
        ...(extractionModel ? { model: extractionModel } : {}),
      },
    },
    future: {
      summarisationEnabled: summaryEnabled,
      longTermMemoryEnabled: memoryEnabled,
      retrievalEnabled: false,
    },
  };
}

export function getModelContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_MODEL_CONTEXT_LIMIT;
}
