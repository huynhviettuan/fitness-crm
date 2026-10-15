# 15 — Deployment

Architecture and costs: `26_TECH_PROPOSAL.md`. Decisions: T-041, T-042. A free trial setup before paying for hosting: `34_TRIAL_DEPLOYMENT.md` (A-314).

## Topology

| Part | Host | Notes |
|---|---|---|
| `apps/web` (Next.js) | Vercel (Pro) | Preview deployment per pull request, pointed at the staging API |
| `apps/api` (NestJS, HTTP) | Railway or Render, Singapore region | Docker image (`apps/api/Dockerfile`, built from the repository root: `docker build -f apps/api/Dockerfile .`); start `node dist/main.js`; platform health check `GET /api/v1/health` (liveness: the process answers; A-315); uptime monitor on `GET /api/v1/health/ready` (`200` when the database answers, `503` when not; A-311) |
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
BACKUP_ENCRYPTION_KEY   # seals the daily backup (A-312): 32 random bytes, base64, not the field key; required in production; kept in the password manager, apart from the bucket
BACKUP_R2_BUCKET        # optional: the backups' own private bucket (recommended); else the files' bucket
BACKUP_CRON             # optional: default "0 2 * * *" (02:00 gym time)
SENTRY_DSN              # optional (A-313): the Sentry project's DSN; unset, no error is reported
SENTRY_ENVIRONMENT      # optional: "staging" or "production" in Sentry; defaults to NODE_ENV
LOG_LEVEL
RELEASE                 # optional: the release shown by /api/v1/health; Railway's and Render's commit is used when unset

# Web (apps/web/.env.example)
API_URL                 # where the web server reaches the API; browsers never call it directly (T-053). Needed at build time too: `next build` reads it
GYM_TIMEZONE            # for showing dates and times
SENTRY_DSN, SENTRY_ENVIRONMENT   # optional (A-313); the release is Vercel's commit
```

Business values (calendar hours, timers, thresholds) are configuration in the database, not environment variables (T-049).

With `NODE_ENV=production` the API and the worker refuse to start, naming the setting, when (A-311):

- `BETTER_AUTH_URL` is not an `https://` URL (the session cookie is Secure; the Origin check compares with it);
- `FILE_STORAGE` is not `r2` (the platform's disk is replaced at each deployment, and the files on it lost);
- `DATABASE_URL` points at the same machine (`localhost`, `127.0.0.1`, `[::1]`);
- any setting the chosen providers need is missing (R2 keys, the Resend key and sender, the VAPID keys).

`EMAIL_PROVIDER=log` only warns, so staging can run without mailing anyone; production sets `resend`.

## Release flow

1. Pull request → CI (`.github/workflows/ci.yml`, pnpm + Turborepo): dependency gate, type-check, lint, unit, integration, OpenAPI contract up to date (`openapi:check`), migrations, E2E with the security suite against both apps.
2. Merge to `main` → deploy API (migrations run as the release step, one deployment at a time) → deploy worker → deploy web, all to staging.
3. Owner trial on staging.
4. Tag a release → the same steps to production.
5. Roll back by redeploying the previous image. Migrations are additive (expand, then contract in a later release), so the previous image keeps working.

## Backups and restore

- Managed daily backups on the database service.
- An independent daily `pg_dump` by the worker to R2, sealed with `BACKUP_ENCRYPTION_KEY` (A-312): `backups/YYYY/MM/flow-….dump.enc`
  and `backups/latest.json`. Logged as `backup.done` / `backup.failed` (alert on a failure, or on no `backup.done` for 26 hours).
- Kept 30 days by the bucket's **lifecycle rule** (Cloudflare dashboard → R2 → the bucket → Settings → Object lifecycle rules:
  prefix `backups/`, delete after 30 days). The application never deletes a backup.
- Before every production migration: `pnpm --filter api backup:now` in the worker's shell.
- A monthly restore drill: in a one-off shell with the production backup key and bucket (read-only keys), into a new empty
  database on staging:

  ```text
  pnpm --filter api backup:restore -- --into postgresql://…/flow_drill_2026_11 [--from backups/2026/11/flow-….dump.enc]
  ```

  It refuses the database it serves and any database with tables, checks the checksum and the seal, then prints the rows of
  users, customers, contracts, payments, bookings, sessions and audit events. Record them beside the live counts of that
  night, then drop the drill database.
- Keys: `BACKUP_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_KEY` are kept in the password manager. A restored copy needs the
  field key of the environment it came from to read ID numbers and health notes.

Drill record:

| Date | Source | Copy | Restored rows (users / customers / contracts / payments / bookings / sessions / audit) | Live rows | Result |
|---|---|---|---|---|---|
| 2026-10-15 | development database, from the API image (`pg_dump` 17.11) | 822 KB sealed | 6 / 130 / 59 / 49 / 268 / 152 / 1529 | the same | Equal; restore into the served database and into a database with tables refused |

## Health check

Two routes answer without a session (A-311, A-315), directly and through the web app (`https://app…/api/v1/…`); nothing
else of the gym is in them:

- `GET /api/v1/health` (**liveness**): `{"status":"ok","release":"…","time":"…"}`; never reads the database. The
  platform's health check: the new release goes live when it answers, and a slow database never makes the platform restart
  a working API.
- `GET /api/v1/health/ready` (**readiness**): `{"status":"ok","database":"ok",…}` with `200`, or `503` with
  `"unavailable"` when the database does not answer within 3 seconds. The uptime monitor (every minute, alert after two
  failures) and the E2E start-up use it.

After a deployment, `release` shows which commit is running.

## Go-live checklist

1. Production database created (PostgreSQL 17, `btree_gist`), daily managed backups and point-in-time recovery on.
2. API and worker services from the same image, `NODE_ENV=production`; the API with `RUN_JOBS=false`, the worker started
   with `node dist/worker.js`; every variable above set, with a new `BETTER_AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` (the key
   kept in the password manager too: losing it loses ID numbers and health notes).
3. `pnpm --filter api db:deploy` as the release step; then `pnpm db:seed` once for the first admin.
4. `GET /api/v1/health/ready` answers `200` with the expected `release`, directly and through the web app.
5. Resend domain verified (SPF, DKIM, DMARC); a test email received; web push keys generated (doc 29).
6. R2 bucket private; a picture uploaded and opened through its signed URL.
7. Sign-in over HTTPS, HSTS present, `/api/docs` answers `404`.
8. The import: dry run, cleanup list confirmed by the owner, reconciliation (M9.3), then the real import with
   `--confirm-production` (A-258, OQ-014).
9. The ZKTeco bridge pointed at the production API with the production machine key (doc 33).
10. Uptime monitor on the health check; Sentry DSNs set; the backup bucket's lifecycle rule set; `backup:now` run once
    and that copy restored into an empty staging database with `backup:restore` (A-312).

## Monitoring

- **Errors** (A-313): Sentry, one project for the API and the worker and one for the web server (or one project, told apart by
  the `service` tag). Reported: the API's `500`s, failed jobs (`job:reminders`, `job:mail`, `job:backup`), pg-boss errors,
  unhandled errors of both processes, and the web server's rendering, Server Action and route errors (with the digest
  that the server log shows). Personal data is removed before sending (doc 24). Alert rule: a new issue, or more than 10
  events in an hour.
- **Logs**: the platform's logs hold request logs, JSON security events (doc 24), `backup.done` / `backup.failed`, and the
  full error with its stack (`Unhandled API error`).
- **Alerts**: bursts of failed sign-ins and cross-origin rejections, job failures, email failures, a failed backup or no
  `backup.done` for 26 hours.
- **Uptime**: `/api/v1/health/ready` directly and through the web app, every minute.
