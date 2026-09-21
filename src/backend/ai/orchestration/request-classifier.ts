/**
 * Month 2 — Week 3 (Prompt 3), Task 2: request classification foundation.
 *
 * Deliberately deterministic: no model call, no scoring, no heuristics that are
 * hard to reason about. A caller that already knows its task (summarisation,
 * memory extraction) states it explicitly; only free-form chat is inspected.
 */

import {
  TASK_CAPABILITIES,
  isAiTaskType,
  type AiClassification,
  type AiTaskType,
} from "@/backend/ai/orchestration/task-types";

const REASONING_HINTS = [
  "why",
  "explain",
  "analyse",
  "analyze",
  "compare",
  "trade-off",
  "tradeoff",
  "pros and cons",
  "step by step",
  "reason",
  "strategy",
  "decide",
  "evaluate",
];

const STRUCTURED_HINTS = ["json", "table", "csv", "schema", "as a list", "bullet points"];

const DOCUMENT_HINTS = ["document", "attached", "this file", "the pdf", "the contract", "the report"];

function classification(task: AiTaskType, reason: string): AiClassification {
  return { task, reason, requiredCapabilities: TASK_CAPABILITIES[task] };
}

export interface ClassifyInput {
  /** Explicit task from an internal caller; always wins over inspection. */
  task?: AiTaskType | string;
  /** The current user message, when the task must be inferred. */
  message?: string;
}

/**
 * Maps a request to a task type. Unknown explicit values fall back to general
 * conversation rather than failing — a caller can never widen its own routing.
 */
export function classifyRequest(input: ClassifyInput = {}): AiClassification {
  if (input.task) {
    if (isAiTaskType(input.task)) return classification(input.task, "explicit");
    return classification("general-conversation", "explicit-unknown");
  }

  const text = (input.message ?? "").toLowerCase();
  if (!text.trim()) return classification("general-conversation", "empty");

  if (DOCUMENT_HINTS.some((hint) => text.includes(hint))) {
    return classification("document-question", "document-hint");
  }
  if (STRUCTURED_HINTS.some((hint) => text.includes(hint))) {
    return classification("structured-generation", "structured-hint");
  }
  if (REASONING_HINTS.some((hint) => text.includes(hint))) {
    return classification("reasoning", "reasoning-hint");
  }
  return classification("general-conversation", "default");
}
