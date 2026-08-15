# Deployment — self-managed VPS (Docker)

NORPIA ships as one container (TanStack Start app, SSR + `/api/v1`) behind Nginx, with
Postgres 16 in the same compose stack.

```text
Internet ──▶ Nginx (:80)  ──▶ app (:3000, Nitro node-server) ──▶ db (:5432, internal only)
```

## Build target

The default build targets an edge worker. Self-hosting uses the Nitro **node-server**
preset, selected by `SERVER_PRESET=node-server` (set in the Docker `build` stage, and
available locally via `bun run build:node` + `bun run start`).

## First deploy

```bash
# on the VPS, as a non-root user in the docker group
git clone <repo> norpia && cd norpia
cp .env.production.example .env.production
# edit .env.production: strong POSTGRES_PASSWORD, APP_ORIGIN=http://<VPS_IP>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Verify:

```bash
curl -s http://localhost/api/v1/health
docker compose -f docker-compose.prod.yml ps
```

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker image prune -f
```

## Configuration rules

- Server-only values live in `.env.production` (git-ignored) and are read inside handlers
  via `src/backend/core/config.ts`.
- `VITE_*` values are baked into the client bundle at **build** time — changing them
  requires a rebuild, not just a restart.
- `DATABASE_URL` points at the internal `db` service host; Postgres publishes no host port.

## Database

- Migrations in `infrastructure/db/migrations/` run automatically on the **first** boot of an
  empty volume. Apply later migrations explicitly:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T db \
    psql -U norpia -d norpia < infrastructure/db/migrations/0002_x.sql
  ```
- Backup / restore:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T db pg_dump -U norpia norpia | gzip > backup-$(date +%F).sql.gz
  gunzip -c backup-2026-08-15.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U norpia -d norpia
  ```

## Hardening checklist

- Firewall: allow 22, 80 (and 443 later) only; the app and DB ports are not published.
- Rotate `POSTGRES_PASSWORD` away from the template value before the first boot.
- Container logs are capped via the json-file driver (10 MB × 5).
- Health checks: container-level `HEALTHCHECK` hits `GET /api/v1/health`.

## Adding a domain + TLS (when available)

1. Point an A record at the VPS IP.
2. Issue certs (certbot standalone or a `certbot/certbot` container) into
   `infrastructure/nginx/certs/`.
3. In `infrastructure/nginx/norpia.conf`, set `server_name`, uncomment the TLS block, and
   redirect `:80` → `:443`.
4. Uncomment the `443:443` port and the certs volume in `docker-compose.prod.yml`.
5. Update `APP_ORIGIN` to `https://<domain>` and redeploy.
