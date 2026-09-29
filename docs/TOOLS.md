# Tool Layer & MCP Foundation (Month 2 — Week 4, Part 1)

```
JARVIS → NORPIA Orchestration ─┬→ AI Provider Layer → OpenAI / Claude
                               └→ Tool Layer        → Tool source (internal today; MCP/API/n8n later)
```

The tool layer is separate from the provider layer. A model may later *ask* for
a tool; only `src/backend/tools/` validates and executes it. Provider adapters
contain no tool code. JARVIS chat does **not** invoke tools yet.

## Modules

| File | Responsibility |
| --- | --- |
| `tools/tool-types.ts` | `ToolDefinition`, descriptor, permissions, result/error contracts |
| `tools/tool-registry.ts` | Register / discover tools, enabled/configured/available, role → permissions |
| `tools/tool-executor.ts` | The execution contract, timeout, normalisation, audit log |
| `tools/tool-http.ts` | Session auth + role lookup (RLS) for `/api/v1/tools` |
| `tools/sources/tool-source.ts` | Interface for future MCP/API/SaaS/n8n sources (inactive) |
| `tools/builtin/*` | Internal tools: `system.time`, `memory.search` |
| `ai/orchestration/tool-bridge.ts` | Single seam orchestration → tools |

## Tool definition

`id, name, description, category, source, inputSchema (Zod), outputSchema (Zod),
permissions, auth (user-session | env-credential | none), enabled, timeoutMs,
metadata, handler(input, ctx)`.

## Execution contract

Request → validate request → validate session → tool exists / enabled /
configured → permissions → input schema (strict, unknown keys rejected) →
execute with timeout + abort → output schema → `ToolResult`.

Errors: `unauthenticated, unknown_tool, tool_disabled, not_configured,
forbidden, invalid_input, invalid_output, timeout, execution_failed` — each
with a fixed, generic message. Raw errors, env var names and credentials never
leave the executor. Each execution logs a content-free `tool.execution` line
(execution id, tool, truncated user id, outcome, duration).

## Security

- Identity comes only from the Supabase bearer token; role from `user_roles`
  via the caller's RLS client. Clients cannot send roles or permissions.
- Permissions: `standard_user` → `system:read, memory:read`; `administrator`
  adds `memory:write, admin`.
- Tools run on the caller's RLS-scoped client — never the service-role key —
  so user isolation is still enforced by the database.
- `TOOLS_DISABLED=a,b` switches tools off without a deploy.
- Only `internal` sources execute; declared MCP/API sources report unavailable.

## API

- `GET /api/v1/tools` — tools the caller may call (admins also get the full registry).
- `POST /api/v1/tools/execute` — `{ toolId, input }`.

The Administration page shows a read-only tool registry panel.

## Adding a tool

1. Create `src/backend/tools/builtin/<name>.ts` with `defineTool({...})`.
2. `registerTool()` it in `tool-registry.ts`.
3. Credentials: `auth: { kind: "env-credential", envVar: "X_API_KEY" }` — read the env var inside the handler only.

External sources (MCP servers etc.) implement `ToolSourceProvider.discover()`
and register the resulting definitions; executor, permissions and audit stay the same.

## Not implemented (intentionally)

MCP client connections, model-driven tool calling in chat, n8n, AI Employees,
autonomous agents, marketplace, advanced automation.

## Chat integration (Week 4, Part 2)

`src/backend/ai/orchestration/tool-planner.ts` connects JARVIS chat to the tool layer:

1. The chat route builds context + memory exactly as before (Weeks 1–2).
2. Role/permissions are read from `user_roles` (RLS) via `resolveToolAccess`.
3. `planToolCall` uses deterministic keyword rules and only considers tools that are
   registered, enabled, available and permitted (`system.time` for time/date questions,
   `memory.search` for "what do you remember about…").
4. `executeTool` validates, executes with timeout and normalises the result.
5. The normalised result (`ToolCallRecord`: tool id/name, request id, user id, input,
   timestamp, status, result or error category) is inserted as a system block directly
   before the current message and sent through the Week 3 orchestrator/provider layer.
6. `ai.tool.call` logs a content-free line (ids, status, duration, provider/model).

Implemented: MCP-style discovery, name, description, input schema, invocation, structured
results and errors for internal tools. Prepared only: external MCP servers, model-driven
native function calling, multi-step tool loops. Any tool-step failure leaves chat unchanged.
