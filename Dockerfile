# NORPIA — local development image (frontend + server layer are one TanStack Start app).
# Production runs on Vercel (see docs/deployment.md); this image is for `docker compose up`.

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
