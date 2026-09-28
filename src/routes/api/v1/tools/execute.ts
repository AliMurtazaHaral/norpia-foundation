/**
 * POST /api/v1/tools/execute — run one tool through the standard contract.
 * Body: { toolId, input }. Identity, role and permissions come from the
 * Supabase session only.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppError } from "@/backend/core/errors";
import { apiRoute } from "@/backend/core/http";
import { executeTool } from "@/backend/tools/tool-executor";
import { TOOL_ERROR_STATUS, toolAuth } from "@/backend/tools/tool-http";

export const Route = createFileRoute("/api/v1/tools/execute")({
  server: {
    handlers: {
      POST: apiRoute(async (ctx) => {
        const caller = await toolAuth(ctx.request, ctx.requestId);
        let body: unknown;
        try {
          body = await ctx.request.json();
        } catch {
          body = null;
        }
        const result = await executeTool(body, { ...caller, signal: ctx.request.signal });
        if (!result.ok) {
          throw new AppError(TOOL_ERROR_STATUS[result.error.code], result.error.message, {
            code: result.error.code,
            executionId: result.meta.executionId,
          });
        }
        return result;
      }),
    },
  },
});
