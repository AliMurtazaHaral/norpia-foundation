/**
 * Future-compatibility contract for external tool sources (MCP servers, APIs,
 * SaaS, n8n, business systems). A source discovers remote capabilities and
 * turns them into ToolDefinitions registered in the central registry, so the
 * executor, permissions and audit path stay identical for every source.
 *
 * INTERFACE ONLY in this phase: no MCP client, no network calls, no n8n.
 */

import type { ToolDefinition, ToolSource } from "../tool-types";

export interface ToolSourceProvider {
  readonly id: string;
  readonly kind: Exclude<ToolSource, "internal">;
  readonly label: string;
  isConfigured(): boolean;
  /** Discover remote tools and map them to NORPIA ToolDefinitions. */
  discover(signal: AbortSignal): Promise<ToolDefinition[]>;
}

/** Declared-but-inactive MCP source used by docs, tests and the admin view. */
export const plannedMcpSource: ToolSourceProvider = {
  id: "mcp",
  kind: "mcp",
  label: "Model Context Protocol servers",
  isConfigured: () => false,
  async discover() {
    return [];
  },
};
