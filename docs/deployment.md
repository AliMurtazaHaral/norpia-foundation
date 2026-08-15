# Deployment — Vercel

NORPIA is one TanStack Start app (SSR UI + `/api/v1`). On Vercel it is built with the Nitro
**vercel** preset, which emits the Build Output API layout (`.vercel/output`): static client
assets on the CDN and the SSR/API handler as a serverless function.

```text
Browser ──▶ Vercel CDN (static assets) ──▶ SSR + /api/v1 function ──▶ managed Postgres (DATABASE_URL)
```

Local development still uses Docker (`docker compose up`) — see `docs/development-environment.md`.

## Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Install command | `bun install --frozen-lockfile` |
| Build command | `SERVER_PRESET=vercel vite build` (or `bun run build:vercel`) |
| Output directory | leave empty (Build Output API is detected automatically) |
| Node.js version | 20.x or newer |

These are already declared in `vercel.json`, so a fresh import needs no manual overrides.

## First deploy

```bash
npm i -g vercel
vercel link
vercel env pull .env.local     # optional: mirror remote env locally
vercel --prod
```

Or connect the Git repository in the Vercel dashboard: every push to the default branch ships
to production, other branches get preview deployments.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production + Preview):

| Key | Scope | Notes |
| --- | --- | --- |
| `APP_NAME` | server | Defaults to `NORPIA` |
| `LOG_LEVEL` | server | `info` in production |
| `DATABASE_URL` | server | Managed Postgres (Vercel Postgres / Neon / Supabase). Use the **pooled** connection string — serverless functions open many short-lived connections |
| `DATABASE_POOL_MAX` | server | Keep low (e.g. `5`) on serverless |
| `STORAGE_*` | server | Phase 2 |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | server | Week 4, leave unset for now |
| `N8N_API_KEY`, `MCP_SERVER_URL` | server | Phase 2 |
| `VITE_APP_ENV` | client | `production` |
| `VITE_API_BASE_URL` | client | `/api/v1` (same origin) |

Rules:

- Server values are read inside handlers via `src/backend/core/config.ts` — never at module
  scope, because Vercel injects env per invocation.
- `VITE_*` values are inlined into the client bundle at **build** time; changing one requires a
  redeploy, not just a restart. Never prefix a secret with `VITE_`.
- `.env` / `.env.local` stay git-ignored; `.env.example` is the only committed template.

## Database

Vercel runs no database. Use a managed Postgres and point `DATABASE_URL` at its pooled endpoint.
Migrations in `infrastructure/db/migrations/` are applied by you against that instance (the
compose Postgres auto-applies them locally only):

```bash
psql "$DATABASE_URL" -f infrastructure/db/migrations/0001_foundation.sql
```

## Runtime constraints (serverless)

- No long-lived processes, in-memory caches, or local filesystem writes outside `/tmp`.
- The in-process event bus (`src/backend/events/`) is per-invocation; a durable transport is a
  later-phase concern and the contract already allows swapping it.
- Avoid Node-only native addons (`sharp`, `child_process`); prefer pure-JS or fetch-based clients.

## Verify a deployment

```bash
curl -s https://<deployment>/api/v1/health
curl -s https://<deployment>/api/v1/system/architecture
```

Logs and per-request traces: Vercel → Project → Deployments → Functions.

## Custom domain

Add it in Vercel → Settings → Domains, point the DNS record Vercel shows, and TLS is issued
automatically. No app change is required (the client calls `/api/v1` on the same origin).
