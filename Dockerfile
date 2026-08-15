# NORPIA — application image (frontend + server layer are one TanStack Start app).
# Targets: `dev` for local development, `runner` for the production VPS deployment.

# ---------- base ----------
FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# ---------- deps (all deps, needed for build + dev) ----------
FROM base AS deps
ENV NODE_ENV=development
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# ---------- dev (used by docker compose) ----------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8080
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

# ---------- build (node-server output for self-hosting) ----------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# SERVER_PRESET switches Nitro from the edge default to a standalone Node/Bun server.
ENV SERVER_PRESET=node-server
RUN bun run build

# ---------- runner (production) ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
# The Nitro node-server bundle is self-contained: no node_modules needed at runtime.
COPY --from=build /app/.output ./.output
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
CMD ["bun", "run", ".output/server/index.mjs"]
