# 15 — Deployment

Architecture and costs: `26_TECH_PROPOSAL.md`. Decisions: T-041, T-042.

## Topology

| Part | Host | Notes |
|---|---|---|
| `apps/web` (Next.js) | Vercel (Pro) | Preview deployment per pull request, pointed at the staging API |
| `apps/api` (NestJS, HTTP) | Railway or Render, Singapore region | Docker image; health check `/api/v1/health` |
| `apps/api` worker (pg-boss jobs) | Same platform, separate service | Same image, worker mode |
| PostgreSQL 17 | Same platform, managed | `btree_gist` extension; daily backups; point-in-time recovery on paid plans |
| Files and backup copies | Cloudflare R2 | Private buckets; signed URLs |
| Email | Resend or Amazon SES | Flow's domain with SPF, DKIM, DMARC |

Domains (example): `app.flowfitness.vn` (web) and `api.flowfitness.vn` (API), so the session cookie is shared on the parent domain.

## Environments

| Environment | Database | Deployed from | Purpose |
|---|---|---|---|
| Local | Docker PostgreSQL | developer machine | development, tests |
| Staging | own PostgreSQL | every merge to `main` | owner's milestone trials, migration rehearsals, import trial (D-039) |
| Production | own PostgreSQL | tagged release | live |

Staging never uses production data, except anonymized copies for migration rehearsals.

## Environment variables

```text
# API
DATABASE_URL            # pooled connection string
DIRECT_DATABASE_URL     # direct connection for migrations
BETTER_AUTH_SECRET      # at least 32 characters, per environment
BETTER_AUTH_URL         # public API origin
WEB_ORIGIN              # web app origin (CORS and Origin check)
COOKIE_DOMAIN           # parent domain for the session cookie
GYM_TIMEZONE            # Asia/Ho_Chi_Minh (A-001)
FIELD_ENCRYPTION_KEY    # AES-256-GCM key for ID and health fields (T-052)
EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
SENTRY_DSN, LOG_LEVEL

# Web
API_URL                 # API origin used by server components
NEXT_PUBLIC_API_URL     # API origin used by the browser
SENTRY_DSN
```

Business values (calendar hours, timers, thresholds) are configuration in the database, not environment variables (T-049).

## Release flow

1. Pull request → CI: lint, type-check, unit, integration, API contract, E2E, security, dependency gate.
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
