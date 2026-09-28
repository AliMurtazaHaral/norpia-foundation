/**
 * Central tool registry: which tools exist, whether they are enabled,
 * configured and available, what they accept and what they require.
 * Not a marketplace — an internal catalogue.
 */

import { z } from "zod";

import { memorySearchTool } from "./builtin/memory-search";
import { systemTimeTool } from "./builtin/system-time";
import type { ToolDefinition, ToolDescriptor, ToolPermission, UserRoleName } from "./tool-types";

const registry = new Map<string, ToolDefinition>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTool(definition: ToolDefinition<any, any>): void {
  const tool = definition as ToolDefinition;
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(tool.id)) throw new Error(`Invalid tool id: ${tool.id}`);
  if (registry.has(tool.id)) throw new Error(`Tool already registered: ${tool.id}`);
  registry.set(tool.id, tool);
}

export function unregisterTool(id: string): void {
  registry.delete(id);
}

export function getTool(id: string): ToolDefinition | undefined {
  return registry.get(id);
}

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name]?.trim() || undefined : undefined;
}

/** Operators can switch tools off without a deploy: TOOLS_DISABLED=a,b */
function operatorDisabled(id: string): boolean {
  return (env("TOOLS_DISABLED") ?? "").split(",").map((s) => s.trim()).includes(id);
}

export function isToolEnabled(tool: ToolDefinition): boolean {
  return tool.enabled && !operatorDisabled(tool.id);
}

export function isToolConfigured(tool: ToolDefinition): boolean {
  return tool.auth.kind !== "env-credential" || Boolean(env(tool.auth.envVar));
}

/** Only internal tools execute in this phase; other sources are declared only. */
export function isToolAvailable(tool: ToolDefinition): boolean {
  return isToolEnabled(tool) && isToolConfigured(tool) && tool.source === "internal";
}

function inputFields(schema: z.ZodTypeAny): string[] {
  return schema instanceof z.ZodObject ? Object.keys(schema.shape as Record<string, unknown>) : [];
}

export function describeTool(tool: ToolDefinition): ToolDescriptor {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    source: tool.source,
    permissions: [...tool.permissions],
    authKind: tool.auth.kind,
    enabled: isToolEnabled(tool),
    configured: isToolConfigured(tool),
    available: isToolAvailable(tool),
    timeoutMs: tool.timeoutMs,
    inputFields: inputFields(tool.inputSchema),
    metadata: { ...(tool.metadata ?? {}) },
  };
}

export function listTools(): ToolDescriptor[] {
  return [...registry.values()].map(describeTool);
}

/** Tools the given permission set may actually call right now. */
export function listToolsFor(permissions: readonly ToolPermission[]): ToolDescriptor[] {
  return listTools().filter(
    (t) => t.available && t.permissions.every((p) => permissions.includes(p)),
  );
}

/** Role → permissions. Server-side only; clients cannot widen this. */
export const ROLE_PERMISSIONS: Record<UserRoleName, readonly ToolPermission[]> = {
  standard_user: ["system:read", "memory:read"],
  administrator: ["system:read", "memory:read", "memory:write", "admin"],
};

export function permissionsForRole(role: UserRoleName): readonly ToolPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

registerTool(systemTimeTool);
registerTool(memorySearchTool);
