# API Guidelines

## Envelope

Success:

```json
{ "success": true, "data": {}, "meta": { "requestId": "…", "timestamp": "…", "apiVersion": "v1" } }
```

Failure:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {} }, "meta": {} }
```

Never hand-build these — return plain data from the handler and let `apiRoute()` serialize it.

## Adding an endpoint

1. Create `src/routes/api/v1/<path>.ts`; the `createFileRoute` string must match the file path.
2. Wrap the handler: `GET: apiRoute((ctx) => service.doThing())`.
3. Validate input with `parseJsonBody(ctx, schema)` / `parseQuery(ctx, schema)`.
4. Put logic in `src/backend/modules/<module>/<module>.service.ts` — never in the route.
5. Throw errors from `src/backend/core/errors.ts`; status codes are derived from the code.
6. Document the endpoint in `src/backend/api/openapi.ts`.

## Rules

- Routes are transport adapters only: no business logic, no database calls, no `fetch` to vendors.
- Protected endpoints add `{ middleware: [requireAuth] }`; do not write ad-hoc auth checks.
- Never return PII from an endpoint under `/api/public/*`.
- Read secrets inside the handler (`process.env['X']`), never at module scope.
- Breaking changes ship as `/api/v2`; `v1` keeps working.
