/**
 * GET  /api/v1/memories — list the caller's long-term memories.
 * POST /api/v1/memories — create one.
 *
 * The caller is identified from the Supabase access token; any user id sent by
 * the client is ignored, and every query is additionally enforced by RLS.
 */

import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, parseJsonBody, parseQuery } from "@/backend/core/http";
import { memoryAuth } from "@/backend/memory/memory-http";
import { createMemory, listMemories } from "@/backend/memory/memory-service";
import { createMemorySchema, listMemoriesSchema } from "@/backend/memory/memory-types";

export const Route = createFileRoute("/api/v1/memories/")({
  server: {
    handlers: {
      GET: apiRoute(async (ctx) => {
        const { supabase, userId } = await memoryAuth(ctx.request);
        const query = parseQuery(ctx, listMemoriesSchema);
        return { items: await listMemories(supabase, userId, query) };
      }),
      POST: apiRoute(
        async (ctx) => {
          const { supabase, userId } = await memoryAuth(ctx.request);
          const input = await parseJsonBody(ctx, createMemorySchema);
          return createMemory(supabase, userId, input);
        },
        { status: 201 },
      ),
    },
  },
});
