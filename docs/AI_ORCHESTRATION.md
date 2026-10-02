# AI Orchestration Foundation (Month 2 — Week 3, Prompt 3)

NORPIA now decides *how* an AI request is handled in one place, above the
provider layer and below JARVIS.

```
JARVIS (chat route)
  → context builder (Week 1) + long-term memory (Week 2)
  → NORPIA orchestration layer   src/backend/ai/orchestration/orchestrator.ts
      → request classification   orchestration/request-classifier.ts
      → model selection          orchestration/model-selection.ts
      → routing configuration    orchestration/routing-config.ts
  → NORPIA AI layer              ai-service.ts
  → provider registry + adapter  provider/*
  → OpenAI (default) / Anthropic (configured only)
  → standardised response + telemetry → JARVIS → user
```

## Modules

| File | Responsibility |
| --- | --- |
| `orchestration/task-types.ts` | Task vocabulary, required capabilities, telemetry shape |
| `orchestration/request-classifier.ts` | Deterministic task classification (no model call) |
| `orchestration/routing-config.ts` | Per-task models, cost preference, fallback, client-selection policy |
| `orchestration/model-selection.ts` | task → capabilities → candidates → selected provider/model |
| `orchestration/orchestrator.ts` | Executes, applies fallback, normalises errors, emits telemetry |

## Request classification

Task types: `general-conversation`, `reasoning`, `summarization`,
`knowledge-question`, `document-question`, `structured-generation`, and the
reserved `tool-request`. Internal callers state their task explicitly; free-form
chat is classified by simple, auditable keyword rules. No AI call, no scoring.
An unknown explicit task degrades to `general-conversation` — a caller can never
widen its own routing.

Each task declares the capabilities it needs (`TASK_CAPABILITIES`), which is the
hook later orchestration phases will extend.

## Model selection

1. A server-validated explicit provider/model wins.
2. Otherwise an operator override for that task (`AI_MODEL_<TASK>`).
3. Otherwise the active provider's default model, whenever it already covers the
   task — so ordinary JARVIS chat is byte-for-byte unchanged on OpenAI.
4. Otherwise the same provider's capable models, ordered by `AI_COST_PREFERENCE`
   (`balanced` default, `cheapest`, `quality`).

Cost metadata comes only from `model-catalog.ts`; nothing infers pricing.

## Fallback

Disabled by default. A fallback is used only when **all** hold: it is enabled,
it names a provider different from the primary, and that provider has a
server-side credential. A configured model must belong to the configured
fallback provider. When the fallback is absent or also fails, the original
normalised error is returned — conversation data is never sent to a provider an
operator has not explicitly approved.

## Usage observability

Every orchestrated request yields a content-free `AiRequestTelemetry`: task,
provider, model, fallback flag, input/output/total tokens, indicative cost,
whether counts were provider-reported, duration, success and normalised error
category. It is merged into the existing `ai.chat.usage` log line. No analytics
dashboard, no billing tables, no message content.

## Security

- Provider credentials are read server-side only, never returned by any API.
- Client-supplied provider/model is ignored unless
  `AI_ALLOW_CLIENT_MODEL_SELECTION=true`, and even then it must match a catalogue
  entry whose provider holds a credential; mismatched pairs are discarded.
- Errors reaching the browser are the normalised `AiProviderError` messages —
  no provider name, no upstream body, no key.
- Context and memory still flow through the Week 1 builder and Week 2 memory
  service; the orchestrator never reads or rewrites conversation content.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `AI_PROVIDER` | Active provider (`openai` default) |
| `AI_MODEL` | Default model for the active provider |
| `AI_MODEL_<TASK>` | Per-task override, e.g. `AI_MODEL_REASONING` |
| `AI_COST_PREFERENCE` | `balanced` (default), `cheapest`, `quality` |
| `AI_FALLBACK_ENABLED` | Enables controlled fallback (default off) |
| `AI_FALLBACK_PROVIDER` / `AI_FALLBACK_MODEL` | Approved fallback target |
| `AI_ALLOW_CLIENT_MODEL_SELECTION` | Allows validated client model choice (default off) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Provider credentials, server-side only |

## Intentionally not implemented yet

MCP, external tools and tool execution, n8n, workflow automation, autonomous
agents / AI employees, multi-agent orchestration and autonomous cost
optimisation are **deliberately out of scope**. `tool-request` and the
capability metadata exist so those phases can be added later without changing
JARVIS, the context builder, the memory system or the provider adapters.

## OpenAI + Anthropic together (update)

- One request → one provider. Task routing (`DEFAULT_TASK_PROVIDERS`): `reasoning`
  and `document-question` → Anthropic (`claude-sonnet-4-6`) when `ANTHROPIC_API_KEY`
  is set; everything else → OpenAI. Override with `AI_PROVIDER_<TASK>`, disable with
  `AI_TASK_ROUTING=false`.
- Fallback only for `FALLBACK_ELIGIBLE` errors (authentication, rate_limit, timeout,
  provider_unavailable, model_unavailable, provider_error) — never invalid_request,
  context_limit or tool_error. One attempt, no loops. Still off unless
  `AI_FALLBACK_ENABLED=true` + `AI_FALLBACK_PROVIDER`.
- `AI_DUAL_PROVIDER_COMPARISON` is reserved and off; nothing sends to both providers.
- Telemetry/usage log now carry `primaryProvider` and `routingReason`
  (`provider-default`, `task-route`, `task-override`, `capability-match`,
  `explicit-request`, `fallback`). `GET /api/v1/ai/providers` shows routing rules.
- `ANTHROPIC_WORKSPACE_ID` is required when the Anthropic key is organisation-level
  (not scoped to a workspace).
