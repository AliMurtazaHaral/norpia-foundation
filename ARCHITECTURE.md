# NORPIA — System Architecture

Status: **Week 2 — System Architecture & Project Foundation**
Scope of this document: the long-lived structure of the AI Operating System. It describes what
exists today, what is contract-only, and how each future capability plugs in.

---

## 1. System components

| Layer | Location | Responsibility | Week 2 status |
| --- | --- | --- | --- |
| Frontend | `src/routes`, `src/components`, `src/lib` | UI, routing, presentation state. Reaches the backend **only** through `src/lib/api/client.ts`. | Implemented |
| Backend / API | `src/routes/api/v1`, `src/backend/core`, `src/backend/modules` | Versioned HTTP API, validation, middleware, services, repositories. | Implemented |
| AI | `src/backend/ai` | Provider-agnostic model contracts + registry. Never imported by UI code. | Contracts + registry |
| Authentication | `src/backend/core/middleware.ts`, `request-context.ts` | Resolves a `principal` and guards routes. | Contract only (Week 3) |
| Database | `src/backend/data` | Repository contracts + in-memory reference adapter. | Contracts + adapter |
| Storage | `src/backend/storage` | Object storage contract for documents/media. | Contract only |
| Integration | `src/backend/integrations` | One interface per external system, plus a registry. | Contracts + registry |
| Events | `src/backend/events` | In-process publish/subscribe bus with a typed event catalogue. | Implemented |

### Directory map

```text
src/
  backend/                 # server-side only; never imported by components
    ai/                    # AI Layer  (ai-provider.ts, ai-registry.ts)
    api/                   # OpenAPI document (API contract)
    core/                  # errors, api-response, http adapter, middleware, request context, config
    data/                  # Database Layer (repository contracts + in-memory adapter)
    events/                # Event Layer (event-types.ts, event-bus.ts)
    integrations/          # Integration Layer (contracts + registry)
    modules/               # feature slices: <module>.schemas | .service | .repository
    storage/               # Storage Layer contract
  lib/api/client.ts        # the only frontend -> backend door
  routes/                  # Frontend routes + /api/v1 server routes
docs/                      # engineering documentation
infrastructure/            # environment/runtime configuration notes
tests/                     # unit tests for core, events and data layers
```

---

## 2. Communication between components

```text
Browser ──HTTP──▶ /api/v1/*  (route = transport only)
                    │
                    ▼
             core/http.ts  ── middleware (logging → auth context → guards)
                    │        ── zod validation of body/query
                    ▼
              modules/*.service.ts  (business logic, transport-agnostic)
                 │            │              │
                 ▼            ▼              ▼
          data/repository  ai/registry  integrations/registry
                 │
                 ▼
             events/event-bus  (side effects, fan-out)
```

Rules enforced by structure:

1. Components never import `src/backend/**`; they call `api` from `src/lib/api/client.ts`.
2. Services never touch `Request`/`Response`; only `core/http.ts` does.
3. The AI Layer is reached through the registry, never by importing a vendor SDK in a component.
4. Database access lives behind repository interfaces only.
5. External APIs are reached only through `IntegrationProvider` implementations.

---

## 3. API strategy

- **Versioned**: everything lives under `/api/v1`. A breaking change means `/api/v2` alongside v1.
- **Consistent envelope**:
  - success `{ "success": true, "data": …, "meta": { requestId, timestamp, apiVersion } }`
  - failure `{ "success": false, "error": { code, message, details? }, "meta": … }`
- **Error taxonomy**: `AppError` + `ErrorCode` (`VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`,
  `INTEGRATION_ERROR`, …). Status codes are derived, never hand-written in routes.
- **Validation**: every body/query parsed with zod (`parseJsonBody`, `parseQuery`); invalid input
  returns `422 VALIDATION_ERROR` with field-level details.
- **Middleware**: composable (`withLogging`, `withAuthContext`, `requireAuth`). Week 3 fills in the
  auth resolver — no route signatures change.
- **Documentation**: OpenAPI 3.1 at `/api/v1/openapi.json`, interactive reference at `/api/docs`.
- **Traceability**: every response carries `x-request-id`; the same id is stamped onto events.

Current endpoints: `GET /health`, `GET /system/architecture`, `GET /ai/providers`,
`GET /integrations`, `GET|POST /events`.

---

## 4. Future integration strategy

`IntegrationProvider` declares `descriptor` (id, category, auth kind, scopes, planned phase),
`isConfigured()`, `healthcheck()` and `listActions()`. Declared today, implemented later:

| Integration | Auth | Planned |
| --- | --- | --- |
| OpenAI, Anthropic | API key | Week 4 (AI chat) |
| MCP | protocol | Phase 2 |
| n8n | API key | Phase 2 |
| Gmail, Google Calendar | OAuth2 | Phase 2 |
| Microsoft 365 | OAuth2 | Phase 3 |

Adding one = implement the interface, `registerIntegration(...)`, store credentials as server-side
secrets. No route, service or UI rewrite required.

The AI Layer mirrors this with `AiProvider` (`complete()`, `capabilities`, `isConfigured()`); today
all providers are placeholders that throw `NOT_IMPLEMENTED`.

---

## 5. Event-driven strategy

A typed in-process bus (`EventBus`). Publishers call `getEventBus().publish(name, payload)`;
subscribers register with `subscribe(name, handler)`. Handler failures are isolated and logged so
they can never break the publisher.

Catalogue: `conversation.created`, `message.created`, `document.uploaded`, `workflow.started`,
`workflow.completed`, `ai.task.created`, `integration.connected`.

Evolution path: the `EventBus` interface stays; the transport is swapped (durable queue, Postgres
outbox, or Cloudflare Queues) when cross-instance delivery is required. Adding an event means one
entry in `DomainEventMap` — typing follows automatically.

---

## 6. Security boundaries

- **Transport boundary**: `/api/v1/*` is the only public surface of the backend.
- **Server-only code**: everything under `src/backend/**` runs server-side; secrets are read inside
  handlers via `process.env`, never at module scope, never with a `VITE_` prefix.
- **Identity boundary**: `RequestContext.principal` is the single source of identity. It is `null`
  until Week 3; `requireAuth` is the only guard routes should use.
- **Validation boundary**: no unvalidated input reaches a service.
- **Data boundary**: the frontend cannot reach the database; only repositories can.
- **Response hygiene**: `cache-control: no-store` on API responses; error details are structured and
  provider errors are logged server-side rather than echoed to clients.
- Out of scope for Week 2 by instruction: RBAC, password reset, email verification, sessions.

---

## 7. Scalability approach

1. **Modular monolith first.** Feature slices under `src/backend/modules/<module>` with
   `schemas | service | repository`. No microservices at this stage.
2. **Extraction path.** Because a module only depends on interfaces (repository, event bus,
   integration provider), any slice can later move behind an HTTP or queue boundary.
3. **Stateless request handling.** Runs on an edge worker runtime; no in-process request state other
   than the dev-only event ring buffer.
4. **Data growth.** Repository contracts already paginate (`page`, `pageSize`, `total`).
5. **AI cost/latency.** Provider indirection allows model routing, caching and fallback in one place.

---

## 8. Explicitly not implemented (later phases)

Advanced authentication, RBAC, password reset, email verification, full AI chat, RAG, vector search,
workflow automation, CRM, subscriptions, payments.
