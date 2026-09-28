/**
 * GET /api/v1/tools — tool discovery for the signed-in caller.
 * Everyone sees the tools they may call; administrators also see the full
 * registry (disabled / unconfigured / declared sources) for inspection.
 */

import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "@/backend/core/http";
import { toolAuth } from "@/backend/tools/tool-http";
import { listTools, listToolsFor } from "@/backend/tools/tool-registry";

export const Route = createFileRoute("/api/v1/tools/")({
  server: {
    handlers: {
      GET: apiRoute(async (ctx) => {
        const caller = await toolAuth(ctx.request, ctx.requestId);
        return {
          role: caller.role,
          permissions: caller.permissions,
          available: listToolsFor(caller.permissions),
          ...(caller.role === "administrator" ? { registry: listTools() } : {}),
        };
      }),
    },
  },
});
