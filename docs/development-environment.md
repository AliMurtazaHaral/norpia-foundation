# Development Environment — NORPIA (Week 2)

## Stack note

NORPIA runs as a single TanStack Start application: React frontend + a
server layer (`src/backend/**`) exposed under `/api/v1`. The FastAPI/Next.js
split from the original brief is mapped onto this stack one-to-one — the
layering, versioning, validation, exception handling, DI and service/repository
separation are identical, they just live in TypeScript instead of Python.

| Brief | Here |
| --- | --- |
| FastAPI app | `src/backend/core/http.ts` + `src/routes/api/v1/**` |
| Routers / versioning | `src/routes/api/v1/**` |
| Pydantic validation | Zod validators in `src/backend/core/http.ts` |
| Exception handlers | `src/backend/core/errors.ts` |
| Dependency injection | `src/backend/core/request-context.ts` + middleware |
| Settings | `src/backend/core/config.ts` (server), `src/lib/config.ts` (browser) |
| Alembic | SQL migrations in `infrastructure/db/migrations/` |
| Next.js frontend | `src/routes/**` + `src/components/**` |

## Start with Docker

```sh
cp .env.example .env      # placeholders only, edit locally
docker compose up --build
```

- App: http://localhost:8080
- Health: http://localhost:8080/api/v1/health
- API docs: http://localhost:8080/api/docs
- Postgres: `localhost:5432` (credentials from `.env`)

Migrations in `infrastructure/db/migrations/` run automatically on the first
database boot. To re-run from scratch: `docker compose down -v && docker compose up`.

## Start without Docker

```sh
cp .env.example .env
bun install       # or npm install
bun run dev
```

## Production-like image

```sh
docker build --target runner -t norpia:local .
docker run --env-file .env -p 3000:3000 norpia:local
```

## Quality

```sh
bun run lint       # ESLint
bun run format     # Prettier
bunx vitest run    # foundation tests
```

## Secrets

`.env` is git-ignored; only `.env.example` (placeholders) is committed. Server
secrets are read inside handlers via `getConfig()`. The browser only ever sees
`VITE_*` values through `src/lib/config.ts`.
