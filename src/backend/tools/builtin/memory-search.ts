import { z } from "zod";

import { retrieveRelevantMemories } from "@/backend/memory/memory-service";

import { defineTool } from "../tool-types";

/**
 * Internal tool: read the caller's own long-term memories through the existing
 * Week 2 memory service. Runs on the caller's RLS-scoped client, so one user
 * can never see another's memories — even if a model asks.
 */
export const memorySearchTool = defineTool({
  id: "memory.search",
  name: "Search my memories",
  description: "Finds the signed-in user's most relevant active long-term memories for a query.",
  category: "memory",
  source: "internal",
  inputSchema: z
    .object({
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  outputSchema: z.object({
    items: z.array(z.object({ content: z.string(), category: z.string(), importance: z.number() })),
  }),
  permissions: ["memory:read"],
  auth: { kind: "user-session" },
  enabled: true,
  timeoutMs: 5_000,
  metadata: { readOnly: true },
  async handler({ query, limit }, ctx) {
    const memories = await retrieveRelevantMemories(ctx.supabase, ctx.userId, {
      query,
      maxMemories: limit,
      maxCharacters: 4_000,
    });
    return {
      items: memories.map((m) => ({ content: m.content, category: m.category, importance: m.importance })),
    };
  },
});
