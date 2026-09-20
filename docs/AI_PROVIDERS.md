# AI Provider Abstraction (Month 2 — Week 3)

NORPIA's intelligence layer no longer depends on a single vendor. JARVIS talks
to an internal AI service; the vendor lives behind an adapter.

```
User → JARVIS UI
     → /api/v1/ai/chat            (auth, ownership, persistence)
     → context + long-term memory (Week 1 / Week 2, unchanged)
     → NORPIA AI layer            src/backend/ai/ai-service.ts
     → provider registry          src/backend/ai/provider/provider-registry.ts
     → provider adapter           src/backend/ai/provider/openai-adapter.ts
     → OpenAI
     → standardised response      → JARVIS → User
```

## Modules

| File | Responsibility |
| --- | --- |
| `provider/provider-types.ts` | Standard request, response, usage, error, adapter contracts |
| `provider/provider-config.ts` | Active provider, default models, availability (env only) |
| `provider/model-catalog.ts` | Every model: provider, capabilities, context window, limits, cost |
| `provider/provider-selection.ts` | Which provider/model handles a request |
| `provider/provider-registry.ts` | Register / resolve / list adapters |
| `provider/openai-adapter.ts` | The only module that knows the OpenAI wire format |
| `provider/anthropic-adapter.ts` | The only module that knows the Anthropic wire format |
| `ai-service.ts` | The NORPIA AI layer every caller uses |

## Model catalogue

`model-catalog.ts` is the single source of model facts. Each entry carries
`provider`, `label`, `capabilities`, `contextWindow`, `maxOutputTokens`,
optional `defaultTemperature` and list-price `cost`. Provider model lists and
the `/api/v1/ai/providers` payload are derived from it, output budgets are
clamped to each model's ceiling, and cost estimates come from it — no model
facts are hardcoded anywhere else.

Capabilities are descriptive only (`text`, `reasoning`, `long-context`,
`structured-output`, `tools`, `vision`, `streaming`). Declaring `tools` does
not execute tools; tool execution is a later roadmap item.

## Provider selection

`selectProviderAndModel()` is deliberately simple:

1. an explicitly named model decides the provider that serves it;
2. otherwise an explicitly named provider uses its default model;
3. otherwise the configured active provider (`AI_PROVIDER`, default `openai`)
   and its default model (`AI_MODEL` or the catalogue default).

No autonomous routing, scoring or fallback chains. Switching NORPIA to Claude
is `AI_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY` — no application code
changes.

## Usage and cost

Both adapters request provider-reported token counts and emit them as a final
usage chunk. The AI layer normalises them into `AiUsage`
(`inputTokens`, `outputTokens`, `totalTokens`, `estimated`, `estimatedCostUsd`)
and falls back to character-based estimates when a provider reports nothing.
`usage-log.ts` records the same content-free structure. There is no billing
system and no new database table.

`chat-provider.ts` and `openai-provider.ts` remain as thin compatibility
re-exports so Week 1 / Week 2 modules (summarisation, memory extraction) and
their tests keep working unchanged.

## Standard request

`AiChatRequest`: `system`, `contextBlocks` (memories + summary), `messages`,
`provider`, `model`, `temperature`, `maxOutputTokens`, `maxInputTokens`,
`signal`, `metadata`. The AI layer fills every unset field from configuration
and hands the adapter a fully resolved request.

## Standard response

`AiChatResponse`: `content`, `provider`, `model`, `usage`, and `metadata`
(`finishReason`, `durationMs`, plus caller metadata). Streaming callers use
`streamChat()`, which returns `{ provider, model, stream }` of `{ delta }`
chunks. Nothing outside an adapter sees a vendor payload.

## Configuration

Server-side environment variables only — no key is ever exposed to the browser.

| Variable | Meaning |
| --- | --- |
| `AI_PROVIDER` | Active provider id (`openai` default) |
| `AI_MODEL` | Default model for the active provider |
| `AI_TEMPERATURE`, `MAX_OUTPUT_TOKENS` | Generation settings |
| `OPENAI_API_KEY` | OpenAI credential |
| `ANTHROPIC_API_KEY` | Reserved for the future Claude adapter |

`GET /api/v1/ai/providers` returns the active provider plus each provider's
label, default model, model list and availability — never credentials.

## Error handling

Adapters translate every failure into an `AiProviderError` with a normalised
`code` and HTTP status:

| Code | Status | Cause |
| --- | --- | --- |
| `authentication` | 502 | Invalid / rejected credential |
| `rate_limit` | 429 | Provider rate limit |
| `timeout` | 504 | Upstream timeout or abort |
| `invalid_request` | 400 | Malformed request |
| `provider_unavailable` | 503 | Missing key, unknown provider, upstream 5xx |
| `provider_error` | 502 | Anything else |

Messages are generic by design: no provider name, no upstream body, no key.

## Adding a provider

1. Implement `AiProviderAdapter` in `src/backend/ai/provider/`.
2. Add its settings (label, key env var, models) to `provider-config.ts`.
3. Register it in `provider-registry.ts`.

No change to JARVIS, the chat route, context building or memory.
