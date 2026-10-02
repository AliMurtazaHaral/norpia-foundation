/**
 * Month 2 — Week 3 (Prompt 3): orchestration vocabulary.
 *
 * A task type describes WHAT is being asked of a model, never HOW it is served.
 * Routing rules, capability requirements and observability all key off these
 * values, so later phases (tools, MCP, agents) can add a task type without
 * touching JARVIS.
 */

import type { ModelCapability } from "@/backend/ai/provider/model-catalog";
import type { AiProviderId } from "@/backend/ai/provider/provider-types";

export type AiTaskType =
  | "general-conversation"
  | "reasoning"
  | "summarization"
  | "knowledge-question"
  | "document-question"
  | "structured-generation"
  /** Reserved for Month 2 Week 4+. Nothing executes tools today. */
  | "tool-request";

export const AI_TASK_TYPES: AiTaskType[] = [
  "general-conversation",
  "reasoning",
  "summarization",
  "knowledge-question",
  "document-question",
  "structured-generation",
  "tool-request",
];

export function isAiTaskType(value: unknown): value is AiTaskType {
  return typeof value === "string" && (AI_TASK_TYPES as string[]).includes(value);
}

/** Capabilities a task needs from whichever model serves it. */
export const TASK_CAPABILITIES: Record<AiTaskType, ModelCapability[]> = {
  "general-conversation": ["text"],
  reasoning: ["text", "reasoning"],
  summarization: ["text"],
  "knowledge-question": ["text"],
  "document-question": ["text", "long-context"],
  "structured-generation": ["text", "structured-output"],
  "tool-request": ["text", "tools"],
};

export interface AiClassification {
  task: AiTaskType;
  /** Why the classifier decided this — logged, never shown to users. */
  reason: string;
  requiredCapabilities: ModelCapability[];
}

/** Content-free record of how a single AI request was handled (Task 5). */
export interface AiRequestTelemetry {
  task: AiTaskType;
  provider: AiProviderId;
  model: string;
  /** Provider that was tried first when a fallback took over. */
  primaryProvider?: AiProviderId;
  usedFallback: boolean;
  /** Why this provider/model was chosen (explicit, task-route, default, …). */
  routingReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  usageReported: boolean;
  durationMs: number;
  success: boolean;
  /** Normalised `AiErrorCode` when the request failed. */
  errorCode?: string;
}
