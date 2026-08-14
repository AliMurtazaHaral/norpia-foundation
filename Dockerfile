# NORPIA — application image (frontend + server layer are one TanStack Start app).
# Multi-stage: `dev` for local development, `runner` for a production-like run.

# ---------- base ----------
FROM oven/bun:1.2-alpine AS base
WORKDIR /app
ENV NODE_ENV=development

# ---------- deps ----------
FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# ---------- dev (used by docker compose) ----------
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8080
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ---------- runner (production-like) ----------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
