/**
 * Month 2 — Week 3 (Prompt 3), Task 3: model selection foundation.
 *
 *   task → required capabilities → configured candidates → selected model
 *
 * The rules are configuration-driven and deterministic. Cost metadata is read
 * but only used when an operator asks for it (`AI_COST_PREFERENCE`).
 */

import {
  getOrchestrationConfig,
  getPrimaryProviderId,
  type CostPreference,
  type OrchestrationConfig,
} from "@/backend/ai/orchestration/routing-config";
import { TASK_CAPABILITIES, type AiTaskType } from "@/backend/ai/orchestration/task-types";
import { getModelDefinition, listModels, type ModelDefinition } from "@/backend/ai/provider/model-catalog";
import { getDefaultModel } from "@/backend/ai/provider/provider-config";
import { selectProviderAndModel } from "@/backend/ai/provider/provider-selection";
import type { AiProviderId } from "@/backend/ai/provider/provider-types";

export interface ModelSelection {
  provider: AiProviderId;
  model: string;
  reason:
    | "explicit-request"
    | "task-override"
    | "capability-match"
    | "provider-default";
}

function averageCost(model: ModelDefinition): number {
  if (!model.cost) return Number.POSITIVE_INFINITY;
  return (model.cost.inputPerMillion + model.cost.outputPerMillion) / 2;
}

function pickByPreference(
  candidates: ModelDefinition[],
  preference: CostPreference,
): ModelDefinition | undefined {
  if (candidates.length === 0) return undefined;
  if (preference === "cheapest") {
    return [...candidates].sort((a, b) => averageCost(a) - averageCost(b))[0];
  }
  if (preference === "quality") {
    return [...candidates].sort(
      (a, b) => b.capabilities.length - a.capabilities.length || averageCost(b) - averageCost(a),
    )[0];
  }
  return candidates[0];
}

export interface SelectModelInput {
  task: AiTaskType;
  /** Server-validated explicit request (never raw client input). */
  provider?: AiProviderId;
  model?: string;
  config?: OrchestrationConfig;
}

export function selectModelForTask(input: SelectModelInput): ModelSelection {
  const config = input.config ?? getOrchestrationConfig();

  // 1. An explicitly requested provider/model always wins — callers that reach
  //    here have already been validated server-side.
  if (input.provider || input.model) {
    const selection = selectProviderAndModel({
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    });
    return { provider: selection.provider, model: selection.model, reason: "explicit-request" };
  }

  const primary = getPrimaryProviderId();

  // 2. Operator-configured per-task model.
  const override = config.taskModels[input.task];
  if (override) {
    const definition = getModelDefinition(override);
    return {
      provider: definition?.provider ?? primary,
      model: override,
      reason: "task-override",
    };
  }

  const defaultModel = getDefaultModel(primary);
  const required = TASK_CAPABILITIES[input.task];
  const defaultDefinition = getModelDefinition(defaultModel);

  // 3. The primary provider's default model keeps JARVIS behaviour unchanged
  //    whenever it already covers the task.
  const defaultCovers =
    !defaultDefinition || required.every((c) => defaultDefinition.capabilities.includes(c));
  if (defaultCovers) {
    return { provider: primary, model: defaultModel, reason: "provider-default" };
  }

  // 4. Otherwise the cheapest/best capable model the SAME provider serves.
  const candidates = listModels(primary).filter(
    (model) => !model.deprecated && required.every((c) => model.capabilities.includes(c)),
  );
  const chosen = pickByPreference(candidates, config.costPreference);
  if (chosen) {
    return { provider: chosen.provider, model: chosen.id, reason: "capability-match" };
  }

  return { provider: primary, model: defaultModel, reason: "provider-default" };
}
