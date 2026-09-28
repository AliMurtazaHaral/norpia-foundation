/**
 * Standard tool execution contract:
 *
 *   Tool request → validate request → validate user/session → validate
 *   permissions → validate input → execute (with timeout) → validate/normalise
 *   output → return to orchestration.
 *
 * Every outcome is a ToolResult. Raw errors, credentials and stack traces never
 * leave this module; a content-free audit line is logged per execution.
 */

import { z } from "zod";

import { getTool, isToolConfigured, isToolEnabled } from "./tool-registry";
import type {
  ToolErrorCode,
  ToolExecutionContext,
  ToolExecutionMeta,
  ToolResult,
} from "./tool-types";

export const toolRequestSchema = z
  .object({
    toolId: z.string().min(1).max(64),
    input: z.unknown().optional(),
  })
  .strict();

const MESSAGES: Record<ToolErrorCode, string> = {
  unauthenticated: "You must be signed in to use tools.",
  unknown_tool: "That tool does not exist.",
  tool_disabled: "That tool is currently disabled.",
  not_configured: "That tool is not configured yet.",
  forbidden: "You do not have permission to use that tool.",
  invalid_input: "The tool input is invalid.",
  invalid_output: "The tool returned an unexpected result.",
  timeout: "The tool took too long to respond.",
  execution_failed: "The tool could not complete the request.",
};

export class ToolTimeoutError extends Error {}

export type ExecutionContextInput = Omit<ToolExecutionContext, "signal"> & { signal?: AbortSignal };

export async function executeTool(
  rawRequest: unknown,
  context: ExecutionContextInput | null,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const executionId = crypto.randomUUID();
  const parsedRequest = toolRequestSchema.safeParse(rawRequest);
  const toolId = parsedRequest.success ? parsedRequest.data.toolId : "unknown";

  const meta = (): ToolExecutionMeta => ({
    executionId,
    toolId,
    userId: context?.userId ?? "anonymous",
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
  });

  const fail = (code: ToolErrorCode, details?: unknown): ToolResult => {
    const result: ToolResult = {
      ok: false,
      toolId,
      error: { code, message: MESSAGES[code], ...(details ? { details } : {}) },
      meta: meta(),
    };
    audit(result);
    return result;
  };

  // 1. Request shape
  if (!parsedRequest.success) return fail("invalid_input");
  // 2. User/session
  if (!context?.userId) return fail("unauthenticated");
  // 3. Tool exists, enabled, configured
  const tool = getTool(toolId);
  if (!tool) return fail("unknown_tool");
  if (!isToolEnabled(tool)) return fail("tool_disabled");
  if (tool.source !== "internal" || !isToolConfigured(tool)) return fail("not_configured");
  // 4. Permissions
  if (!tool.permissions.every((p) => context.permissions.includes(p))) return fail("forbidden");
  // 5. Input schema
  const input = tool.inputSchema.safeParse(parsedRequest.data.input ?? {});
  if (!input.success) return fail("invalid_input", input.error.flatten());

  // 6. Execute with timeout + abort propagation
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  context.signal?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      tool.handler(input.data, { ...context, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolTimeoutError());
        }, tool.timeoutMs);
      }),
    ]);
    // 7. Normalise output
    const checked = tool.outputSchema.safeParse(output);
    if (!checked.success) return fail("invalid_output");
    const result: ToolResult = { ok: true, toolId, output: checked.data, meta: meta() };
    audit(result);
    return result;
  } catch (error) {
    return fail(error instanceof ToolTimeoutError ? "timeout" : "execution_failed");
  } finally {
    if (timer) clearTimeout(timer);
    context.signal?.removeEventListener("abort", onParentAbort);
  }
}

/** Content-free audit record: no input, no output, no credentials. */
function audit(result: ToolResult): void {
  console.info(
    JSON.stringify({
      event: "tool.execution",
      executionId: result.meta.executionId,
      toolId: result.toolId,
      user: result.meta.userId.slice(0, 8),
      ok: result.ok,
      ...(result.ok ? {} : { errorCode: result.error.code }),
      durationMs: result.meta.durationMs,
    }),
  );
}
