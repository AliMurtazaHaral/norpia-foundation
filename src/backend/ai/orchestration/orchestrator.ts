/**
 * Month 2 — Week 3 (Prompt 3), Tasks 1/4/5: the NORPIA orchestration layer.
 *
 *   JARVIS
 *     ↓
 *   Orchestration layer   (classify → select → execute → normalise → observe)
 *     ↓
 *   Provider selection
 *     ↓
 *   Provider adapter      (OpenAI / Anthropic)
 *
 * It owns the DECISION; the AI service (`ai-service.ts`) still owns the call,
 * and the Week 1 context builder plus the Week 2 memory system still own what
 * goes into the prompt. Nothing here inspects or rewrites conversation content.
 */

import { streamChat as streamViaAiLayer, type ChatStreamHandle } from "@/backend/ai/ai-service";
import { classifyRequest } from "@/backend/ai/orchestration/request-classifier";
import { selectModelForTask } from "@/backend/ai/orchestration/model-selection";
import {
  getOrchestrationConfig,
  resolveFallback,
  type OrchestrationConfig,
} from "@/backend/ai/orchestration/routing-config";
import {
  type AiClassification,
  type AiRequestTelemetry,
  type AiTaskType,
} from "@/backend/ai/orchestration/task-types";
import { getModelDefinition } from "@/backend/ai/provider/model-catalog";
import { hasCredential } from "@/backend/ai/provider/provider-config";
import {
  AiProviderError,
  type AiChatRequest,
  type AiProviderId,
  type AiStreamChunk,
  type AiUsage,
} from "@/backend/ai/provider/provider-types";

export interface OrchestratedRequest extends Omit<AiChatRequest, "provider" | "model"> {
  /** Known task from an internal caller (summarisation, extraction, …). */
  task?: AiTaskType;
  /** Current user message, used only for deterministic classification. */
  classifyText?: string;
  /** Server-validated provider/model override. Never raw client input. */
  provider?: AiProviderId;
  model?: string;
  config?: OrchestrationConfig;
}

export interface OrchestratedStream {
  classification: AiClassification;
  provider: AiProviderId;
  model: string;
  usedFallback: boolean;
  primaryProvider: AiProviderId;
  stream: AsyncGenerator<AiStreamChunk>;
  getUsage(): AiUsage | undefined;
  /** Content-free record of how this request was handled. */
  getTelemetry(): AiRequestTelemetry;
}

/**
 * Security (Task 9): a provider/model named by a browser request is only
 * honoured when the server explicitly allows client selection AND the value
 * exists in the server-side catalogue. Anything else is silently ignored.
 */
export function validateClientSelection(
  input: { provider?: unknown; model?: unknown },
  config: OrchestrationConfig = getOrchestrationConfig(),
): { provider?: AiProviderId; model?: string } {
  if (!config.allowClientModelSelection) return {};
  const model = typeof input.model === "string" ? getModelDefinition(input.model) : undefined;
  if (!model) return {};
  if (typeof input.provider === "string" && input.provider !== model.provider) return {};
  if (!hasCredential(model.provider)) return {};
  return { provider: model.provider, model: model.id };
}

/**
 * Streaming entry point. The first chunk is awaited here so a primary-provider
 * failure can still be handled — either by the approved fallback or by a
 * normalised error — before any bytes reach the browser.
 */
export async function orchestrateChatStream(
  request: OrchestratedRequest,
): Promise<OrchestratedStream> {
  const config = request.config ?? getOrchestrationConfig();
  const classification = classifyRequest({
    ...(request.task ? { task: request.task } : {}),
    ...(request.classifyText ? { message: request.classifyText } : {}),
  });

  const selection = selectModelForTask({
    task: classification.task,
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.model ? { model: request.model } : {}),
    config,
  });

  const startedAt = Date.now();
  const {
    task: _task,
    classifyText: _classifyText,
    config: _config,
    provider: _provider,
    model: _model,
    ...base
  } = request;

  async function attempt(
    provider: AiProviderId,
    model: string,
  ): Promise<{ handle: ChatStreamHandle; first: IteratorResult<AiStreamChunk> }> {
    const handle = streamViaAiLayer({ ...base, provider, model });
    const iterator = handle.stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    // Re-expose the primed iterator as a fresh generator.
    const stream = (async function* () {
      let result = first;
      while (!result.done) {
        yield result.value;
        result = await iterator.next();
      }
    })();
    return { handle: { ...handle, stream, getUsage: handle.getUsage }, first };
  }

  let usedFallback = false;
  let handle: ChatStreamHandle;
  let errorCode: string | undefined;

  try {
    ({ handle } = await attempt(selection.provider, selection.model));
  } catch (primaryError) {
    errorCode = primaryError instanceof AiProviderError ? primaryError.code : "provider_error";
    const fallback = resolveFallback(selection.provider, config);
    if (!fallback) throw primaryError;
    try {
      const fallbackModel = fallback.model ?? selectModelForTask({
        task: classification.task,
        provider: fallback.provider,
        config,
      }).model;
      ({ handle } = await attempt(fallback.provider, fallbackModel));
      usedFallback = true;
      errorCode = undefined;
    } catch {
      // The fallback failed too: surface the ORIGINAL normalised error.
      throw primaryError;
    }
  }

  let finished = false;
  let success = true;
  const wrapped = (async function* () {
    try {
      for await (const chunk of handle.stream) yield chunk;
    } catch (error) {
      success = false;
      errorCode = error instanceof AiProviderError ? error.code : "provider_error";
      throw error;
    } finally {
      finished = true;
    }
  })();

  return {
    classification,
    provider: handle.provider,
    model: handle.model,
    usedFallback,
    primaryProvider: selection.provider,
    stream: wrapped,
    getUsage: handle.getUsage,
    getTelemetry: () => {
      const usage = handle.getUsage();
      return {
        task: classification.task,
        provider: handle.provider,
        model: handle.model,
        ...(usedFallback ? { primaryProvider: selection.provider } : {}),
        usedFallback,
        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
        ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
        ...(usage?.estimatedCostUsd !== undefined
          ? { estimatedCostUsd: usage.estimatedCostUsd }
          : {}),
        usageReported: usage ? !usage.estimated : false,
        durationMs: Date.now() - startedAt,
        success: success && finished,
        ...(errorCode ? { errorCode } : {}),
      };
    },
  };
}
