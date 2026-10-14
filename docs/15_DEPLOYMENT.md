# 15 — Deployment

Architecture and costs: `26_TECH_PROPOSAL.md`. Decisions: T-041, T-042.

## Topology

| Part | Host | Notes |
|---|---|---|
| `apps/web` (Next.js) | Vercel (Pro) | Preview deployment per pull request, pointed at the staging API |
| `apps/api` (NestJS, HTTP) | Railway or Render, Singapore region | Docker image; start `node dist/main.js`; health check `/api/auth/ok` until a dedicated `/api/v1/health` exists |
| `apps/api` worker (pg-boss jobs) | Same platform, separate service | Same image; start `node dist/worker.js`. The API service sets `RUN_JOBS=false` so only the worker runs the reminders (T-059) |
| PostgreSQL 17 | Same platform, managed | `btree_gist` extension; daily backups; point-in-time recovery on paid plans |
| Files and backup copies | Cloudflare R2 | Private buckets; signed URLs |
| Email | Resend or Amazon SES | Flow's domain with SPF, DKIM, DMARC |

Domains (example): `app.flowfitness.vn` (web) and `api.flowfitness.vn` (API). Browsers use only the web domain: the web app forwards `/api/*` to the API (T-053), so the session cookie belongs to the web domain and the API needs no CORS. The API domain is for future direct clients (member app, devices).

## Environments

| Environment | Database | Deployed from | Purpose |
|---|---|---|---|
| Local | Docker PostgreSQL | developer machine | development, tests |
| Staging | own PostgreSQL | every merge to `main` | owner's milestone trials, migration rehearsals, import trial (D-039) |
| Production | own PostgreSQL | tagged release | live |

Staging never uses production data, except anonymized copies for migration rehearsals.

## Environment variables

```text
# API (apps/api/.env.example)
PORT                    # default 4000
DATABASE_URL            # pooled connection string
DATABASE_POOL_SIZE      # default 5
DIRECT_DATABASE_URL     # direct connection for migrations (planned)
BETTER_AUTH_SECRET      # at least 32 characters, per environment
BETTER_AUTH_URL         # the web app's public URL: Better Auth's base URL and the only Origin allowed to change state (T-033, T-053)
NODE_ENV                # production: no /api/docs, HSTS on
GYM_TIMEZONE            # Asia/Ho_Chi_Minh (A-001)
FIELD_ENCRYPTION_KEY    # AES-256-GCM key for ID and health fields (T-052, T-064): 32 random bytes, base64; one per environment, backed up apart from the database
EMAIL_PROVIDER (`log` or `resend`), EMAIL_FROM, RESEND_API_KEY; PUSH_PROVIDER (`log` or `webpush`), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (one key pair per environment: `npx web-push generate-vapid-keys`, doc 29); META_GRAPH_URL (Lead Ads, M10.4: leave the default `https://graph.facebook.com/v21.0`)
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
SENTRY_DSN, LOG_LEVEL

# Web (apps/web/.env.example)
API_URL                 # where the web server reaches the API; browsers never call it directly (T-053). Needed at build time too: `next build` reads it
GYM_TIMEZONE            # for showing dates and times
SENTRY_DSN
```

Business values (calendar hours, timers, thresholds) are configuration in the database, not environment variables (T-049).

## Release flow

1. Pull request → CI (`.github/workflows/ci.yml`, pnpm + Turborepo): dependency gate, type-check, lint, unit, integration, OpenAPI contract up to date (`openapi:check`), migrations, E2E with the security suite against both apps.
2. Merge to `main` → deploy API (migrations run as the release step, one deployment at a time) → deploy worker → deploy web, all to staging.
3. Owner trial on staging.
4. Tag a release → the same steps to production.
5. Roll back by redeploying the previous image. Migrations are additive (expand, then contract in a later release), so the previous image keeps working.

## Backups and restore

- Managed daily backups on the database service.
- An independent daily `pg_dump` by the worker to R2, kept 30 days (encrypted).
- A monthly restore of the latest dump into staging, checked and recorded.
- Before every production migration: an on-demand backup.

## Monitoring

Sentry for web and API errors; platform logs for request logs and JSON security events; alerts on bursts of failed sign-ins and cross-origin rejections, job failures, and email failures; uptime checks on web and API health.
