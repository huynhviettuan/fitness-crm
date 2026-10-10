# 15 — Deployment

## V1 deployment decision

V1 uses a **single full-stack Next.js application deployed on Vercel**.

A separate NestJS/Railway backend is intentionally not part of V1.

```text
GitHub
  |
  v
Vercel
└── Next.js full-stack application
    ├── UI
    ├── Server Actions
    ├── /api/v1 Route Handlers
    └── application/domain services
            |
            v
          Prisma
            |
            v
     Managed PostgreSQL
```

## Why this deployment is used

The system is an internal CRM for one gym and does not currently need independent backend scaling, worker infrastructure, device integration, or microservices.

The V1 approach reduces:

- number of deployed applications
- CORS configuration
- duplicated environment configuration
- API-client boilerplate between separate frontend/backend repositories
- operational overhead

It still preserves clean backend boundaries inside the Next.js codebase so a separate service can be extracted later if justified.

## PostgreSQL hosting

Use a managed PostgreSQL provider with a connection model compatible with Vercel/serverless workloads.

Acceptable examples include managed PostgreSQL products such as Neon, Supabase, or another approved provider.

The application must receive database connection information through environment variables. Do not couple domain code to the database vendor.

## Domain

A purchased domain is optional.

Initial production/internal launch can use the Vercel-provided URL, for example:

```text
https://fitness-crm.vercel.app
```

A custom domain can be attached later, for example:

```text
https://crm.yourgym.vn
```

A separate `api.` domain is unnecessary in V1 because the HTTP API is served by the same Next.js application under `/api/v1`.

## Environments

Minimum:

- `local`
- `production`

Recommended while development remains active:

- `local`
- `preview`
- `production`

Vercel preview deployments may be created per pull request, but preview must **not** point at production data.

If a dedicated staging environment is introduced, it must use its own database.

## Environment variables

Typical variables:

```text
DATABASE_URL          # pooled connection string in deployed environments
BETTER_AUTH_SECRET    # at least 32 characters; generate per environment (T-028)
BETTER_AUTH_URL       # the deployment's public URL
NEXT_PUBLIC_APP_URL
LOG_LEVEL
GYM_TIMEZONE          # default Asia/Ho_Chi_Minh (A-001)
SCHEDULE_START_HOUR   # PT calendar's first hour, default 6 (T-038)
SCHEDULE_END_HOUR     # PT calendar's last hour, default 22
```

Local development and CI only (see `.env.example`):

```text
TEST_DATABASE_URL     # Vitest integration tests; must differ from DATABASE_URL
E2E_DATABASE_URL      # Playwright; must differ from DATABASE_URL
SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME   # npm run db:seed
```

The server validates its environment at startup (`src/lib/env.ts`) and refuses to start with a missing or invalid value.

Security-relevant settings (see `24_SECURITY_TESTING.md`):

- `BETTER_AUTH_URL` must be the exact public origin of each deployment, preview deployments included. The API's Origin check and Better Auth both use it.
- Sign-in rate limiting needs the real client IP. Vercel provides it in a single-value `X-Forwarded-For`; behind another proxy, configure `advanced.ipAddress` in `src/lib/auth/auth.ts`.
- HSTS is sent only by production builds.

Optional provider-specific database variables may be used when required, but secrets must never be committed to Git.

## Database connection requirements

Because Vercel uses elastic/serverless execution characteristics:

- use a serverless-compatible or pooled PostgreSQL connection string where supported
- do not create uncontrolled database connection pools per request
- centralize Prisma client creation
- verify provider connection limits before production launch
- verify the provider supports the `btree_gist` extension, which the trainer-overlap constraint needs (T-014)

## Database migrations

Production deploy must use migration-based schema changes.

Typical Prisma workflow:

```text
prisma migrate dev       # local development
prisma migrate deploy    # controlled production migration
```

Do not use `prisma db push` as the production schema migration strategy. It would also skip database objects that Prisma does not model, such as the trainer-overlap exclusion constraint, which lives only in migration SQL (`04_DATA_MODEL_ERD.md`).

Production migration execution must be controlled so multiple deployment instances do not race to apply migrations.

## CI/CD

Recommended flow:

```text
feature branch
    |
    v
Pull Request
    |
    ├── dependency audit gate (npm run security:audit)
    ├── lint
    ├── type-check
    ├── unit/integration tests (integration tests use a PostgreSQL service in CI)
    └── optional Playwright against preview/test environment
    |
    v
merge to main
    |
    v
production migration step
    |
    v
Vercel production deployment
    |
    v
smoke test
```

Do not make production deployment depend only on a successful frontend build. Database migration and critical smoke-test readiness must be part of the release process.

## Backup

Before production go-live:

1. Enable automated PostgreSQL backups or provider-supported point-in-time recovery where available.
2. Document the restore procedure.
3. Perform at least one test restore.
4. Confirm who owns restore access.

## Logging and monitoring

At minimum capture:

- application/server errors
- authentication failures
- failed critical mutations
- session completion/audit events
- financial mutation/audit events

Do not log passwords, auth secrets, raw tokens, or other sensitive credentials.

## Future extraction trigger

Do not introduce Railway or a separate backend proactively.

Reconsider a separate backend/worker service only if requirements emerge such as:

- fingerprint/local-device connector
- high-volume messaging webhooks
- long-running background jobs
- queue workers
- heavy report/file generation
- workloads unsuitable for Vercel request execution

See `19_FUTURE_ROADMAP.md` and `22_TECHNICAL_ARCHITECTURE.md`.
