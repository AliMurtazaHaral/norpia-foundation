/**
 * Month 2 — Week 4 (Part 2): tool-aware orchestration.
 *
 *   Context + Memory → Orchestration → plan tool? → Tool Layer (validate,
 *   authorise, execute, normalise) → result block → AI provider → reply
 *
 * Tool selection is deterministic and auditable (keyword rules, like the
 * request classifier) — no autonomous decisions. Only tools that are
 * registered, enabled, available AND permitted for the caller are candidates.
 * Provider adapters never see tool code; they receive the result as text.
 */

import { runToolForOrchestration, toolsAvailableToCaller } from "./tool-bridge";
import type { ExecutionContextInput } from "@/backend/tools/tool-executor";
import { getTool } from "@/backend/tools/tool-registry";
import type { ToolErrorCode, ToolPermission } from "@/backend/tools/tool-types";
import type { AiTurn } from "@/backend/ai/provider/provider-types";

export type RequestIntent = "conversation" | "context" | "tool";

export interface PlannedToolCall {
  toolId: string;
  input: Record<string, unknown>;
  reason: string;
}

/** Standard tool-call record (MCP-style: name, input, structured result). */
export interface ToolCallRecord {
  toolId: string;
  toolName: string;
  requestId: string;
  executionId: string;
  userId: string;
  input: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
  status: "success" | "error";
  result?: unknown;
  error?: { category: ToolErrorCode; message: string };
}

const TIME_RE =
  /\b(what(?:'s| is)? (?:the )?(?:current )?(?:time|date|day)|what time is it|today'?s date|current (?:time|date)|which day is (?:it|today))\b/i;
const MEMORY_RE =
  /\b(what do you (?:remember|know) about|search (?:my )?memor(?:y|ies)|do you remember)\b/i;
const IANA_RE = /\b((?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?|UTC)\b/;

/** Small, explicit city → zone table. Anything else defaults to UTC. */
const CITY_ZONES: Record<string, string> = {
  paris: "Europe/Paris",
  london: "Europe/London",
  berlin: "Europe/Berlin",
  zurich: "Europe/Zurich",
  "new york": "America/New_York",
  tokyo: "Asia/Tokyo",
  dubai: "Asia/Dubai",
  sydney: "Australia/Sydney",
};

/** Decide deterministically whether a message needs a tool, and which. */
export function planToolCall(
  message: string,
  permissions: readonly ToolPermission[],
): PlannedToolCall | null {
  const text = message.trim();
  if (!text) return null;
  const allowed = new Set(toolsAvailableToCaller(permissions).map((t) => t.id));

  if (TIME_RE.test(text) && allowed.has("system.time")) {
    const zone =
      text.match(IANA_RE)?.[1] ??
      Object.entries(CITY_ZONES).find(([city]) => text.toLowerCase().includes(city))?.[1];
    return { toolId: "system.time", input: zone ? { timeZone: zone } : {}, reason: "time-question" };
  }
  if (MEMORY_RE.test(text) && allowed.has("memory.search")) {
    return { toolId: "memory.search", input: { query: text.slice(0, 500) }, reason: "memory-question" };
  }
  return null;
}

/** Explicit tool intents the caller is NOT allowed to run (for safe replies). */
export function detectIntent(message: string, planned: PlannedToolCall | null): RequestIntent {
  if (planned) return "tool";
  if (TIME_RE.test(message) || MEMORY_RE.test(message)) return "tool";
  return /\b(earlier|before|last time|we discussed|remind me)\b/i.test(message) ? "context" : "conversation";
}

export async function executePlannedTool(
  plan: PlannedToolCall,
  context: ExecutionContextInput,
): Promise<ToolCallRecord> {
  const result = await runToolForOrchestration({ toolId: plan.toolId, input: plan.input }, context);
  const base = {
    toolId: plan.toolId,
    toolName: getTool(plan.toolId)?.name ?? plan.toolId,
    requestId: context.requestId,
    executionId: result.meta.executionId,
    userId: context.userId,
    input: plan.input,
    timestamp: result.meta.startedAt,
    durationMs: result.meta.durationMs,
  };
  return result.ok
    ? { ...base, status: "success", result: result.output }
    : { ...base, status: "error", error: { category: result.error.code, message: result.error.message } };
}

/** Render the normalised result as a context block the provider can read. */
export function renderToolResult(record: ToolCallRecord): string {
  const payload =
    record.status === "success"
      ? { status: "success", tool: record.toolId, result: record.result }
      : { status: "error", tool: record.toolId, error: record.error };
  return [
    "## Tool result (NORPIA tool layer)",
    "A registered tool was executed for the current user message. Base your answer on this",
    "actual result. If the status is error, tell the user briefly that the tool could not",
    "complete the request; do not invent a result.",
    "```json",
    JSON.stringify(payload).slice(0, 4_000),
    "```",
  ].join("\n");
}

/** Insert the tool block as a system turn directly before the current message. */
export function withToolResult(messages: AiTurn[], block: string): AiTurn[] {
  const copy = [...messages];
  const lastUser = copy.map((m) => m.role).lastIndexOf("user");
  const at = lastUser === -1 ? copy.length : lastUser;
  copy.splice(at, 0, { role: "system", content: block });
  return copy;
}

/** Content-free observability line complementing `ai.chat.usage`. */
export function logToolCall(record: ToolCallRecord, provider?: string, model?: string): void {
  console.info(
    JSON.stringify({
      event: "ai.tool.call",
      requestId: record.requestId,
      executionId: record.executionId,
      user: record.userId.slice(0, 8),
      toolId: record.toolId,
      toolName: record.toolName,
      status: record.status,
      durationMs: record.durationMs,
      ...(record.error ? { errorCode: record.error.category } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      timestamp: record.timestamp,
    }),
  );
}
