/**
 * Month 2 — Week 4 (Part 1): the single seam between orchestration and the
 * tool layer. The AI provider may later return "call tool X with Y"; the
 * orchestrator hands that to `runToolForOrchestration`, never to an adapter.
 * JARVIS chat does not invoke tools yet.
 */

import { executeTool, type ExecutionContextInput } from "@/backend/tools/tool-executor";
import { listToolsFor } from "@/backend/tools/tool-registry";
import type { ToolDescriptor, ToolPermission, ToolResult } from "@/backend/tools/tool-types";

export function toolsAvailableToCaller(permissions: readonly ToolPermission[]): ToolDescriptor[] {
  return listToolsFor(permissions);
}

export function runToolForOrchestration(
  request: { toolId: string; input: unknown },
  context: ExecutionContextInput,
): Promise<ToolResult> {
  return executeTool(request, context);
}
