# NORPIA / JARVIS — Advanced Context & Conversation Management (Month 2, Week 1)

Developer reference for how a JARVIS reply is produced. Everything described
here is server-side; the browser only sends a Supabase access token, a
conversation id and one message.

---

## 1. Conversation architecture

| Table | Purpose | Owner column |
| --- | --- | --- |
| `public.conversations` | one row per chat thread | `user_id` |
| `public.messages` | every user / assistant turn, chronological by `created_at` | `user_id` (+ `conversation_id`) |
| `public.conversation_summaries` | ONE rolling summary per conversation | `user_id` (+ unique `conversation_id`) |

Migrations, in order:

```
0004_chat.sql               conversations + messages + RLS
0005_chat_performance.sql   idx_conversations_user_updated, idx_messages_conversation_created
0006_conversation_summaries.sql  conversation_summaries + grants + RLS + updated_at trigger
```

Conversation lifecycle (frontend, `src/lib/chat/chat-api.ts`):
create → appears in the sidebar (`updated_at desc`) → open by route
`/chat/$conversationId` → messages load ascending by `created_at`.
Refreshing the browser or reopening an old conversation re-reads from
Supabase, so nothing lives only in React state.

## 2. Message architecture

- Roles: `user`, `assistant` (`system` is never persisted — it is generated
  per request from the versioned prompt).
- Ordering is always `created_at ASC` when displayed or sent to the model.
- The user message is persisted **before** the model call, so a provider
  failure never loses input.
- The assistant message is persisted exactly once, after the stream completes.
- Duplicate protection: if the newest stored message is an identical `user`
  message younger than `DUPLICATE_WINDOW_MS` (2 min), the retry reuses it
  instead of inserting a second copy.

## 3. Context retrieval

`src/backend/ai/conversation-context.ts` is the single entry point.

```
authenticated user
  → loadOwnedConversation()      ownership check (404 if not yours)
  → loadConversationSummary()    RLS + explicit user_id filter
  → loadConversationHistory()    messages newer than the summary cutoff
  → buildChatContext()           bounded, chronological
```

`loadConversationHistory` queries newest-first with `LIMIT
maxHistoryMessages` (so the limit keeps the *recent* turns) and reverses the
rows before returning them, guaranteeing chronological order. When a summary
exists, the query adds `created_at > covered_through`, so summarised messages
are never replayed verbatim — that is what prevents duplication between the
summary block and the recent block.

## 4. Context builder

`buildChatContext` (`src/backend/ai/context-manager.ts`) emits, in order:

```
1. SYSTEM INSTRUCTIONS   versioned JARVIS prompt (jarvis-prompt.ts)
2. CONVERSATION SUMMARY  system block, only when a summary exists
3. RECENT MESSAGES       chronological, bounded
4. CURRENT USER MESSAGE  already the last recent turn (persisted first)
```

Two budgets apply, newest-first, so the latest turn always survives:

- `maxContextCharacters`
- `maxInputTokens * 4 − (system prompt + memory blocks)` characters

`memoryBlocks` is the declared seam for later phases (long-term memory, RAG).
Nothing populates it today except the conversation summary.

## 5. Conversation summarization

`src/backend/ai/conversation-summary.ts`.

- **Trigger** (`shouldSummarize`): fires when
  `totalMessages − summarizedMessages >= SUMMARY_TRIGGER_MESSAGES`. Never on
  every message.
- **Scope**: only the older part. The newest `SUMMARY_KEEP_RECENT_MESSAGES`
  turns are always excluded and stay verbatim.
- **Content**: `SUMMARY_PROMPT` asks for decisions, requirements, goals,
  stated facts, unresolved questions and explicit instructions — bullet
  points, no invention, under 250 words. Small talk is intentionally dropped.
- **Rolling**: the previous summary is fed back in, so information from very
  old turns survives further compaction. `version` increments each pass.
- **Cost guards**: `SUMMARY_MAX_SOURCE_MESSAGES` (500 rows), transcript
  truncated to `SUMMARY_MAX_SOURCE_CHARACTERS`, output capped by
  `SUMMARY_MAX_OUTPUT_TOKENS`, optional cheaper `SUMMARY_MODEL`.
- **When it runs**: after the assistant reply is persisted, so it never delays
  the first token the user sees.

### Summary storage

`conversation_summaries` holds one row per conversation:
`summary`, `covered_through` (cutoff instant), `covered_message_count`,
`version`, `model`, timestamps. Written with `upsert(..., { onConflict:
"conversation_id" })`. A trigger keeps `updated_at` fresh and makes `user_id`
and `conversation_id` immutable.

This is **not** long-term memory: a summary is never read outside its own
conversation. Cross-conversation memory is Month 2 Week 2.

## 6. Token / context management

Configured centrally in `src/backend/ai/context-config.ts` — nothing else in
the codebase hard-codes these numbers.

| Variable | Default | Effect |
| --- | --- | --- |
| `MAX_CONTEXT_MESSAGES` | see `jarvis-prompt.ts` | recent turns retrieved |
| `MAX_OUTPUT_TOKENS` | see `jarvis-prompt.ts` | reply length cap |
| `MAX_INPUT_TOKENS` | per-model limit | input budget for one request |
| `SUMMARY_ENABLED` | `true` | `false` disables summarisation entirely |
| `SUMMARY_TRIGGER_MESSAGES` | `24` | unsummarised turns before a pass |
| `SUMMARY_KEEP_RECENT_MESSAGES` | `10` | turns kept verbatim |
| `SUMMARY_MAX_SOURCE_CHARACTERS` | `24000` | transcript cap |
| `SUMMARY_MAX_OUTPUT_TOKENS` | `400` | summary length cap |
| `SUMMARY_MODEL` | chat model | optional cheaper summariser |

Token counts are estimated at ~4 characters/token (`estimateTokens`) — good
enough for budgeting and usage logging, not exact tokenisation.

## 7. Security and RLS

- Identity comes from the `Authorization: Bearer <supabase access token>`
  header only. Any `user_id` in the request body is ignored.
- All queries use a **user-scoped** Supabase client (anon key + bearer). The
  service-role key is never imported or referenced by the chat path.
- RLS on `conversations`, `messages` and `conversation_summaries` scopes every
  row to `auth.uid()`; the explicit ownership checks in code are defence in
  depth.
- IDOR: a conversation id belonging to another user returns the same `404` as
  a non-existent one, so ids cannot be used to probe for other accounts.
- Summaries are loaded with both `conversation_id` and `user_id` filters, so
  User A's summary can never enter User B's request.
- `OPENAI_API_KEY` is read server-side only and never appears in a response,
  a log line, or the client bundle.

## 8. Error handling

| Failure | Behaviour |
| --- | --- |
| Missing / invalid token | `401`, friendly message |
| Unknown or foreign conversation | `404`, indistinguishable |
| Empty or malformed body | `400` (Zod) |
| Message over the limit | `413` with the limit stated |
| Message insert fails | `500`, nothing streamed |
| Provider fails before the first chunk | real HTTP error (`AiProviderError.status`, else `502`) |
| Provider fails mid-stream | partial text is persisted with a bracketed notice |
| Empty model reply | user-visible notice, nothing persisted |
| Summarisation fails | swallowed; logged as `ai.chat.summary_failed` with truncated ids and no content; the conversation continues on recent messages and the trigger retries next turn |

Technical details, stack traces and provider payloads never reach the browser.
Usage logging (`usage-log.ts`) records counts and durations only — never
message content or keys.

## 9. Request flow (end to end)

```
browser  POST /api/v1/ai/chat  { conversation_id, message }
         Authorization: Bearer <supabase token>
   ↓
auth (getUser) → validate (Zod) → ownership check
   ↓
persist user message (unless duplicate/retry)
   ↓
prepareConversationContext  (reuses the already-verified conversation)
   ↓
OpenAI stream  →  text/plain chunks  →  browser renders incrementally
   ↓
persist assistant message  →  maybeSummarize (best effort)
```

## 10. Optimizations applied in the Week 1 QA pass

- The conversation is loaded **once** per request and handed to the context
  layer (ownership re-asserted) instead of being fetched twice.
- The summary bookkeeping `count` query is skipped entirely when
  `SUMMARY_ENABLED=false`.
- Summarisation loads at most `SUMMARY_MAX_SOURCE_MESSAGES` rows.
- Both hot query paths are index-backed
  (`idx_conversations_user_updated`, `idx_messages_conversation_created`).
