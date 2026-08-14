# Infrastructure

## Runtime

- Build: Vite 7 + TanStack Start (React 19, SSR).
- Server: edge worker runtime. Node-only packages (native addons, child_process, sharp) are not
  supported; prefer pure-JS or fetch-based clients.
- Deployment: Lovable preview (every change) and published production build.

## Environments

| Environment | Purpose | Notes |
| --- | --- | --- |
| Local / preview | Development and review | Latest preview build |
| Production | Published app | Requires an explicit publish after secret changes |

## Configuration & secrets

- Server-side values: `process.env['NAME']`, read **inside** a handler (env is injected per request).
- Client-visible values: `import.meta.env.VITE_*` only. Never prefix a secret with `VITE_`.
- Declared-but-unset keys for future phases: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `N8N_API_KEY`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET`. None are used in Week 2.
- Central accessor: `src/backend/core/config.ts`.

## Planned (later phases)

- Database + storage provisioning via Lovable Cloud.
- Background jobs / durable event transport once the in-process bus is outgrown.
- Structured log shipping and uptime checks against `GET /api/v1/health`.
