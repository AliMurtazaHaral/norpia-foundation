# JARVIS AI Chat (Week 4)

## Flow
Browser → `POST /api/v1/ai/chat` (server route, secrets stay server-side) → OpenAI → streamed back to the browser.
The browser never calls OpenAI and never sees `OPENAI_API_KEY`.

> Note: this project is a TanStack Start app deployed on Vercel, not a Next.js/Supabase-Functions
> app. The server route is the equivalent of the requested Edge Function: same trust boundary
> (server-only secret, Supabase-token auth, RLS-scoped queries), one less runtime to deploy.

## Authentication
The route reads the Supabase access token from the `Authorization: Bearer` header and resolves the
user with `supabase.auth.getUser()`. Any `user_id` sent by the client is ignored. All database
queries run through a user-scoped Supabase client, so RLS enforces ownership a second time.

## Validation
- `conversation_id` must be a UUID, must exist, and must belong to the caller.
- `message` must be non-empty and within `AI_MAX_MESSAGE_LENGTH` (default 8000 chars).

## Persistence
1. User message is inserted before the model call (never lost on failure).
2. History is loaded (last `AI_MAX_HISTORY_MESSAGES` messages of that conversation only).
3. The completed assistant message is inserted once, with `{ provider, model }` metadata.
   A partially streamed answer that fails mid-way is stored with `interrupted: true`.

## Configuration
| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | – | Server-only secret |
| `AI_MODEL` | `gpt-4o-mini` | Model id, single source of truth |
| `AI_MAX_OUTPUT_TOKENS` | `1024` | Output cap (cost control) |
| `AI_TEMPERATURE` | `0.4` | Sampling |
| `AI_MAX_HISTORY_MESSAGES` | `20` | Context window (cost control) |
| `AI_MAX_MESSAGE_LENGTH` | `8000` | Input cap |

## Extending to other providers
`src/backend/ai/chat-provider.ts` defines the `ChatProvider` streaming contract.
`resolveChatProvider()` in `src/backend/ai/openai-provider.ts` is the registry — add Anthropic or
Gemini there; no call sites change.

## Persona
`src/backend/ai/jarvis-prompt.ts` holds the isolated system prompt. It forbids JARVIS from claiming
access to email, calendars, files, or CRM systems until those integrations exist.
