/**
 * GET    /api/v1/memories/:id — read one memory.
 * PATCH  /api/v1/memories/:id — update it (including is_active for deactivation).
 * DELETE /api/v1/memories/:id — permanently remove it.
 *
 * Ownership is enforced twice: an explicit user_id filter and Supabase RLS.
 * Another user's id returns 404, never 403, so ids cannot be probed.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiRoute, parseJsonBody, parseWith } from "@/backend/core/http";
import { memoryAuth, pathId, toApiError } from "@/backend/memory/memory-http";
import { deleteMemory, getMemory, updateMemory } from "@/backend/memory/memory-service";
import { updateMemorySchema } from "@/backend/memory/memory-types";

const idSchema = z.string().uuid();

export const Route = createFileRoute("/api/v1/memories/$id")({
  server: {
    handlers: {
      GET: apiRoute(async (ctx) => {
        const { supabase, userId } = await memoryAuth(ctx.request);
        const id = parseWith(idSchema, pathId(ctx.request));
        try {
          return await getMemory(supabase, userId, id);
        } catch (error) {
          throw toApiError(error);
        }
      }),
      PATCH: apiRoute(async (ctx) => {
        const { supabase, userId } = await memoryAuth(ctx.request);
        const id = parseWith(idSchema, pathId(ctx.request));
        const input = await parseJsonBody(ctx, updateMemorySchema);
        try {
          return await updateMemory(supabase, userId, id, input);
        } catch (error) {
          throw toApiError(error);
        }
      }),
      DELETE: apiRoute(async (ctx) => {
        const { supabase, userId } = await memoryAuth(ctx.request);
        const id = parseWith(idSchema, pathId(ctx.request));
        try {
          await deleteMemory(supabase, userId, id);
        } catch (error) {
          throw toApiError(error);
        }
        return { id, deleted: true };
      }),
    },
  },
});
