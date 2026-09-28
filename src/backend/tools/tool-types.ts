/**
 * Month 2 — Week 4 (Part 1): NORPIA tool layer contracts.
 *
 *   NORPIA Orchestration → Tool Layer → Tool source (internal / MCP / API / …)
 *
 * The tool layer is deliberately separate from the AI provider layer: a model
 * may ASK for a tool, but only this layer validates and executes it. Provider
 * adapters never contain tool code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

/** Where a tool's capability comes from. Only "internal" executes today. */
export type ToolSource = "internal" | "mcp" | "api" | "saas" | "n8n" | "business-system";

export type ToolCategory = "system" | "memory" | "knowledge" | "productivity" | "automation";

/** Fine-grained permissions a tool may require. Granted per role, server-side. */
export type ToolPermission = "system:read" | "memory:read" | "memory:write" | "admin";

export type ToolAuthRequirement =
  /** Runs as the signed-in user, RLS-scoped. */
  | { kind: "user-session" }
  /** Needs a server-side credential in an environment variable. */
  | { kind: "env-credential"; envVar: string }
  | { kind: "none" };

export interface ToolExecutionContext {
  userId: string;
  role: UserRoleName;
  permissions: readonly ToolPermission[];
  /** RLS-scoped client for the caller. Never the service-role key. */
  supabase: SupabaseClient;
  requestId: string;
  signal: AbortSignal;
}

export type UserRoleName = "administrator" | "standard_user";

export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  source: ToolSource;
  inputSchema: I;
  outputSchema: O;
  permissions: ToolPermission[];
  auth: ToolAuthRequirement;
  enabled: boolean;
  timeoutMs: number;
  metadata?: Record<string, string | number | boolean>;
  handler: (input: z.infer<I>, ctx: ToolExecutionContext) => Promise<z.infer<O>>;
}

/** Public, credential-free description used by discovery and the admin view. */
export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  source: ToolSource;
  permissions: ToolPermission[];
  authKind: ToolAuthRequirement["kind"];
  enabled: boolean;
  configured: boolean;
  available: boolean;
  timeoutMs: number;
  inputFields: string[];
  metadata: Record<string, string | number | boolean>;
}

export type ToolErrorCode =
  | "unauthenticated"
  | "unknown_tool"
  | "tool_disabled"
  | "not_configured"
  | "forbidden"
  | "invalid_input"
  | "invalid_output"
  | "timeout"
  | "execution_failed";

export interface ToolExecutionMeta {
  executionId: string;
  toolId: string;
  userId: string;
  startedAt: string;
  durationMs: number;
}

export type ToolResult =
  | { ok: true; toolId: string; output: unknown; meta: ToolExecutionMeta }
  | { ok: false; toolId: string; error: { code: ToolErrorCode; message: string; details?: unknown }; meta: ToolExecutionMeta };

export interface ToolRequest {
  toolId: string;
  input: unknown;
}

/** Helper preserving input/output inference when authoring a tool. */
export function defineTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  definition: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return definition;
}
