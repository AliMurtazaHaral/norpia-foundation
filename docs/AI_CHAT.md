# NORPIA — JARVIS AI Chat (Week 4)

## 1. Architecture

```
Browser (React / TanStack Start)
  └─ src/components/chat/*        chat UI, streaming, retry, markdown
  └─ src/lib/chat/chat-api.ts     Supabase CRUD (RLS-scoped)
  └─ src/lib/chat/ai-client.ts    fetch bridge, sends the Supabase token only
        │  POST /api/v1/ai/chat   (Authorization: Bearer <supabase access token>)
        ▼
Server route  src/routes/api/v1/ai/chat.ts
  ├─ auth        supabase.auth.getUser() from the bearer token
  ├─ ownership   conversation.user_id === user.id (plus RLS)
  ├─ persistence user message stored BEFORE the model call
  ├─ context     src/backend/ai/context-manager.ts
  ├─ prompt      src/backend/ai/jarvis-prompt.ts (versioned registry)
  ├─ provider    src/backend/ai/openai-provider.ts → OpenAI (streaming)
  └─ usage       src/backend/ai/usage-log.ts (content-free)
```

> This project is a TanStack Start app on Vercel, not Next.js/Supabase Functions.
> The server route is the equivalent of the requested Edge Function: same trust
> boundary (server-only secret, Supabase-token auth, RLS-scoped queries), one
> less runtime to deploy.

## 2. Supabase schema

| Table | Columns | Notes |
| --- | --- | --- |
| `public.conversations` | `id`, `user_id → auth.users`, `title`, `metadata`, `created_at`, `updated_at` | `updated_at` refreshed by trigger on new messages |
| `public.messages` | `id`, `conversation_id → conversations`, `user_id`, `role` (`message_role` enum), `content`, `metadata`, `created_at` | ownership resolved through the parent conversation |

Indexes (migration `0005_chat_performance.sql`):

- `idx_conversations_user_updated (user_id, updated_at desc)` — sidebar list
- `idx_messages_conversation_created (conversation_id, created_at)` — transcript + context window
- `idx_messages_user` dropped: redundant, only cost insert throughput.

Migrations to run in order: `0004_chat.sql`, `0005_chat_performance.sql`, then `0006_conversation_summaries.sql`.

## 3. Authentication flow

1. The browser holds a Supabase session (Week 3 auth).
2. `ai-client.ts` attaches `Authorization: Bearer <access_token>`; no other identity is sent.
3. The route resolves the user with `supabase.auth.getUser()` — any `user_id` in the payload is ignored.
4. Every query runs through a user-scoped client, so RLS enforces ownership a second time.
5. `/chat` lives under `_authenticated`, so unauthenticated users never reach the UI.

## 4. Conversation memory & context management

`src/backend/ai/context-manager.ts` is the only place that decides what the model sees:

- loads the newest `MAX_CONTEXT_MESSAGES` rows of **that conversation only**;
- applies a `MAX_CONTEXT_CHARACTERS` budget newest-first, dropping the oldest turns;
- always keeps the latest message, even when it alone exceeds the budget;
- returns `stats` (counts only) used for usage logging.

Result: JARVIS resolves references across turns ("My company is called NORPIA."
→ later "What should I focus on for the company?") without unbounded token spend.

Clear separation of concerns in the request sent upstream:

```
[system]  versioned JARVIS prompt
[system]  conversation summary   (older messages, when one exists)
[system]  memory blocks          (extension point for Month 2 Week 2+)
[history] bounded recent turns, oldest → newest
[user]    the current message (last history turn)
```

### 4.1 Conversation summarisation (Month 2 Week 1)

Long conversations are split into four conceptual layers: **summary of older
messages**, **recent messages**, **current user message**, on top of the system
instructions. Implementation:

| Piece | File |
| --- | --- |
| Summary prompt, trigger, generation, storage | `src/backend/ai/conversation-summary.ts` |
| Layering into the final context | `src/backend/ai/conversation-context.ts` |
| Configuration | `src/backend/ai/context-config.ts` |
| Table + RLS | `infrastructure/db/migrations/0006_conversation_summaries.sql` |

- One rolling summary per conversation (`public.conversation_summaries`,
  unique on `conversation_id`), with `covered_through`, `covered_message_count`
  and an incrementing `version`.
- Recent history is loaded with `created_at > covered_through`, so summarised
  messages are never replayed twice.
- Trigger: after a reply, when `total messages − summarised messages >=
  SUMMARY_TRIGGER_MESSAGES`. The newest `SUMMARY_KEEP_RECENT_MESSAGES` turns
  always stay verbatim.
- Failure handling: summarisation runs best-effort. A provider or write failure
  logs `ai.chat.summary_failed` (ids truncated, no content) and the next turn
  falls back to recent-message context. The conversation is never destroyed.
- Security: summaries are user data. RLS scopes them by `auth.uid()` **and**
  conversation ownership, and every read filters `user_id` explicitly, so one
  user's summary can never enter another user's AI request.
- This is deliberately *not* cross-conversation memory — that is Month 2 Week 2.

Env knobs: `SUMMARY_ENABLED`, `SUMMARY_TRIGGER_MESSAGES`,
`SUMMARY_KEEP_RECENT_MESSAGES`, `SUMMARY_MAX_SOURCE_CHARACTERS`,
`SUMMARY_MAX_OUTPUT_TOKENS`, `SUMMARY_MODEL`.

## 5. System prompt

`src/backend/ai/jarvis-prompt.ts` holds a **versioned registry** (`PROMPT_VERSIONS`),
selected with `AI_PROMPT_VERSION`. Each assistant message stores
`metadata.prompt_version`, so past answers stay traceable to the prompt that
produced them. The prompt states that JARVIS can only execute an action when the
required integration or tool is actually connected — today none are.

## 6. Token & cost management

| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | – | Server-only secret |
| `AI_MODEL` | `gpt-4o-mini` | Model id, single source of truth |
| `AI_PROMPT_VERSION` | `v1` | Active system prompt |
| `AI_TEMPERATURE` | `0.4` | Sampling |
| `MAX_OUTPUT_TOKENS` | `1024` | Output cap |
| `MAX_CONTEXT_MESSAGES` | `20` | History window |
| `MAX_CONTEXT_CHARACTERS` | `24000` | Input budget |
| `MAX_MESSAGE_LENGTH` | `8000` | Single message cap (enforced client + server) |

Legacy `AI_MAX_*` names are still honoured. Additional controls:

- duplicate/retry submissions reuse the stored user message (2-minute window);
- the client blocks concurrent sends and over-limit drafts before any request;
- titles are derived locally — no extra model call;
- `logAiUsage` records provider, model, message counts, estimated tokens,
  duration and status. Content and secrets are never logged.

## 7. Reliability & UX

- Streaming deltas rendered progressively, with a thinking indicator before the first token.
- Failure surfaces an inline error with a **Retry** button; retry never duplicates the user message.
- Partial answers interrupted mid-stream are stored with `metadata.interrupted = true`.
- Empty state with starter suggestions, auto-scroll, skeleton loaders, character counter.
- Markdown with GFM, safe rendering (no raw HTML), code blocks with a copy button.
- Responsive: sidebar stacks above the transcript on mobile.

## 8. Security review (Week 4)

- RLS enabled on `conversations` and `messages`; policies scope every row to `auth.uid()`.
- Ownership re-checked explicitly in the route before any write.
- `OPENAI_API_KEY` is read only inside the provider module, server-side; never sent to the browser, never logged.
- The service-role key is never used by the chat path.
- Upstream error bodies are never echoed to the client.
- Automated coverage in `tests/ai-chat.test.ts` and `tests/chat-context.test.ts`.

## 9. Known limitations

- No conversation summarisation: very long conversations lose their oldest turns.
- Memory is per-conversation; nothing is remembered across conversations.
- Token counts are estimates (~4 chars/token), not billed usage.
- Streaming cannot be stopped mid-answer.
- Usage logs go to the platform log stream, not a metering table.

## 10. Future architecture (not implemented)

`MemorySource` in `context-manager.ts` is the single insertion point for later phases:
conversation summarisation, long-term memory, and RAG retrieval all implement it and
their output is injected as memory blocks — no call-site changes. Providers plug into
`resolveChatProvider`; MCP, n8n and multi-agent orchestration remain out of scope.

---

## WEEK 4 COMPLETION REPORT

| Criterion | Status |
| --- | --- |
| JARVIS chat interface works | Done |
| New conversations work | Done |
| Conversation history works | Done |
| Messages persist in Supabase | Done |
| OpenAI integration works | Done |
| OpenAI key is server-side | Done |
| Streaming responses work | Done |
| Markdown works | Done |
| Code blocks work (with copy) | Done |
| Loading states work | Done |
| Error states work | Done |
| Retry works (no duplicate messages) | Done |
| Basic conversation memory works | Done |
| Context management works | Done |
| System prompt configurable & versioned | Done |
| RLS protects conversations | Done |
| User-specific data isolation | Done |
| Authentication enforced | Done |
| Basic cost control implemented | Done |
| Documentation updated | Done |

Deliberately excluded (later phases): advanced RAG, MCP, n8n, AI Employees,
multi-agent orchestration, billing.

Action required: run `infrastructure/db/migrations/0005_chat_performance.sql`
in the Supabase SQL editor.

## Context preparation layer (Month 2 — Week 1)

All context assembly is server-side. The frontend only sends
`{ conversation_id, message }`; it never builds prompts or history.

```
POST /api/v1/ai/chat
  → authenticate (Supabase bearer token, RLS-scoped client)
  → loadOwnedConversation()      src/backend/ai/conversation-context.ts
  → persist user message (dedup within DUPLICATE_WINDOW_MS)
  → prepareConversationContext() → chronological history + bounded window
  → provider.streamChat()        src/backend/ai/openai-provider.ts
  → persist assistant message + content-free usage log
```

### Modules

| File | Responsibility |
| --- | --- |
| `src/backend/ai/context-config.ts` | Centralized context configuration + per-model context limits |
| `src/backend/ai/conversation-context.ts` | Ownership check, chronological history, context preparation |
| `src/backend/ai/context-manager.ts` | Pure windowing: message limit, character budget, token budget |
| `src/backend/ai/jarvis-prompt.ts` | Versioned system prompt + model configuration |

### Configuration

| Env var | Meaning |
| --- | --- |
| `MAX_CONTEXT_MESSAGES` | Number of recent messages replayed |
| `MAX_CONTEXT_CHARACTERS` | Character ceiling for history |
| `MAX_INPUT_TOKENS` | Estimated input-token ceiling (defaults to the model's limit) |
| `MAX_OUTPUT_TOKENS` | Cap on the model's answer |
| `MAX_MESSAGE_LENGTH` | Longest accepted single user message |
| `AI_MODEL`, `AI_PROMPT_VERSION`, `AI_TEMPERATURE` | Model + prompt selection |

Future summarisation, long-term memory and retrieval plug into
`prepareConversationContext({ memoryBlocks })`; they are declared as disabled
flags in `ContextConfig.future` and are **not** implemented yet.

### Security

- The conversation is loaded through the caller's RLS-scoped client and its
  `user_id` is compared to the authenticated user; a foreign id returns 404,
  so ids cannot be used to probe another user's data.
- The OpenAI key is read only inside the server handler and never returned.
- No database change was required for this work.
