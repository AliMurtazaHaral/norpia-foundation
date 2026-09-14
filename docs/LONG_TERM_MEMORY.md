# Long-Term Memory (Month 2 — Week 2)

Long-term memory stores durable facts about a **user** that stay useful across
conversations. It is deliberately separate from conversation summaries, which
describe **one** conversation (see `docs/CONTEXT_MANAGEMENT.md`).

| Concern | Conversation summary | Long-term memory |
| --- | --- | --- |
| Scope | one conversation | the user |
| Table | `conversation_summaries` | `user_memories` |
| Lifetime | regenerated as the conversation grows | persists until deactivated/deleted |
| Created by | automatic summarisation | the user today; automatic extraction next prompt |

## Data model — `user_memories`

Migration: `infrastructure/db/migrations/0007_user_memories.sql` (run after `0006`).

| Column | Purpose |
| --- | --- |
| `user_id` | owner (`auth.users`), enforced by every RLS policy |
| `content` | the memory itself (1–2000 chars) |
| `category` | `preference`, `personal`, `professional`, `goal`, `project`, `fact`, `instruction`, `business`, `other` |
| `importance` | 1–5, drives retrieval ranking |
| `source` | `user`, `assistant`, `system`, `import` |
| `source_conversation_id` | optional provenance, nulled if the conversation is deleted |
| `is_active` | soft delete: inactive memories never reach the model |
| `metadata` | open JSONB for future needs |
| `last_used_at` | bookkeeping when a memory shaped a reply |
| `created_at` / `updated_at` | timestamps, `updated_at` maintained by trigger |

Categories are a `check` constraint rather than a Postgres enum, so adding one
is a single-line change plus the matching entry in `memory-types.ts`.

## Layers

```
UI (Settings → Memory)
  └─ src/lib/memory/memory-api.ts        (bearer token → /api/v1/memories)
       └─ src/routes/api/v1/memories/*   (transport only, standard envelope)
            └─ src/backend/memory/memory-service.ts   (all memory logic)
                 └─ Supabase (RLS-scoped client of the caller)
```

`memory-service.ts` exposes `createMemory`, `listMemories`, `getMemory`,
`updateMemory`, `deactivateMemory`, `deleteMemory`,
`retrieveRelevantMemories`, `memoryContextBlocks` and `markMemoriesUsed`.

## Retrieval

Deterministic and cheap — no embeddings, no vector search (those belong to the
later RAG phase):

1. Load active memories of the authenticated user (bounded candidate pool).
2. Score: `importance × 2 + keyword overlap × 3 + recency bonus`.
3. Keep the top `MEMORY_MAX_ITEMS` within `MEMORY_MAX_CHARACTERS`.
4. Render one labelled system block.

## Context order

```
system instructions
+ long-term user memory      ← new in Week 2
+ conversation summary
+ recent messages
+ current user message
```

Retrieval failure is non-fatal: the conversation continues without memories.

## Security

- Every policy on `user_memories` is anchored on `auth.uid() = user_id`.
- The service always adds an explicit `user_id` filter (defence in depth).
- An unknown or foreign memory id returns `404`, never `403`, so ids cannot be
  used to probe other users' data.
- Endpoints authenticate from the Supabase access token; a `user_id` in the
  request body is ignored.
- No `anon` grant; OpenAI keys stay server-side.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MEMORY_ENABLED` | `true` | set `false` to stop injecting memories |
| `MEMORY_MAX_ITEMS` | `12` | memories per request |
| `MEMORY_MAX_CHARACTERS` | `2000` | character budget for the memory block |

## Not implemented yet

Automatic memory extraction from conversations (next prompt), embeddings,
pgvector, RAG, document processing, provider abstraction, MCP, n8n, tools.
