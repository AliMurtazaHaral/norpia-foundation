# Long-Term Memory (Month 2 — Week 2)

Long-term memory stores durable facts about a **user** that stay useful across
conversations. It is deliberately separate from conversation summaries, which
describe **one** conversation (see `docs/CONTEXT_MANAGEMENT.md`).

| Concern | Conversation summary | Long-term memory |
| --- | --- | --- |
| Scope | one conversation | the user |
| Table | `conversation_summaries` | `user_memories` |
| Lifetime | regenerated as the conversation grows | persists until deactivated/deleted |
| Created by | automatic summarisation | the user, plus automatic extraction from conversations |

## Data model — `user_memories`

Migration: `infrastructure/db/migrations/0007_user_memories.sql` (run after `0006`).

| Column | Purpose |
| --- | --- |
| `user_id` | owner (`auth.users`), enforced by every RLS policy |
| `content` | the memory itself (1–2000 chars) |
| `category` | `preference`, `personal`, `professional`, `goal`, `project`, `fact`, `instruction`, `business`, `other` |
| `importance` | 1–5, drives retrieval ranking |
| `confidence` | 0–1 (migration `0008`), how sure the extractor is; weights ranking |
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

## Automatic extraction (Prompt 2)

Migration: `infrastructure/db/migrations/0008_memory_extraction.sql` (after `0007`)
adds `user_memories.confidence` and `conversations.memory_extracted_through`.

`src/backend/memory/memory-extraction.ts` runs server-side **after** a reply is
finished, never on every message:

1. Trigger — at least `MEMORY_EXTRACTION_TRIGGER_MESSAGES` messages newer than
   the conversation's extraction bookmark.
2. Only those unanalysed turns are read (bounded by rows and characters).
3. The model receives the extraction rules plus the user's existing active
   memories, and answers with strict JSON candidates
   (`content`, `category`, `importance`, `confidence`, `replaces`).
4. `planMemoryChanges` filters by `MEMORY_MIN_CONFIDENCE` / `MEMORY_MIN_IMPORTANCE`,
   detects duplicates by normalised word overlap, and decides create / update / skip.
5. Writes happen through the caller's RLS-scoped client, then the bookmark moves
   forward. Failure is non-fatal and leaves the bookmark untouched.

Duplicate and update handling:

- A rephrasing of a stored memory is **not** stored again; only its importance
  is lifted when the new signal is stronger.
- When a candidate names the memory it `replaces`, that memory is rewritten in
  place (Project A → Project B) instead of contradicting the old one.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MEMORY_ENABLED` | `true` | set `false` to stop injecting memories |
| `MEMORY_MAX_ITEMS` | `12` | memories per request |
| `MEMORY_MAX_CHARACTERS` | `2000` | character budget for the memory block |
| `MEMORY_EXTRACTION_ENABLED` | `true` | set `false` to stop automatic extraction |
| `MEMORY_EXTRACTION_TRIGGER_MESSAGES` | `6` | unanalysed messages before a pass |
| `MEMORY_EXTRACTION_MAX_SOURCE_MESSAGES` | `40` | rows read per pass |
| `MEMORY_EXTRACTION_MAX_SOURCE_CHARACTERS` | `12000` | transcript budget |
| `MEMORY_EXTRACTION_MAX_EXISTING` | `40` | existing memories shown to the extractor |
| `MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS` | `500` | extractor answer budget |
| `MEMORY_EXTRACTION_MODEL` | chat model | optional cheaper model |
| `MEMORY_MIN_CONFIDENCE` | `0.6` | candidates below this are discarded |
| `MEMORY_MIN_IMPORTANCE` | `2` | candidates below this are discarded |
| `MEMORY_DUPLICATE_THRESHOLD` | `0.45` | word-overlap score treated as the same fact |
| `MEMORY_MAX_PER_RUN` | `5` | maximum writes per pass |

## Not implemented yet

Embeddings, pgvector, RAG, document processing, provider abstraction, MCP,
n8n, external tools, autonomous agents.
