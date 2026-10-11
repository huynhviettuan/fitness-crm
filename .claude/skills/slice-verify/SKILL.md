---
name: slice-verify
description: Run every quality gate for a Flow Fitness slice in its worktree — format, typecheck, lint, unit, integration, E2E plus security, OpenAPI, dependency audit — and check its migrations on a pg_dump copy of the dev database. Use before committing a slice, or when asked to verify a worktree.
---

# Verify a slice

Run from the slice's worktree root (never from `D:\fitness-crm`, where the user runs `pnpm dev`). pnpm 12: `corepack pnpm` (set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`) or `npx --yes pnpm@12.5.1`. Docker container: `fitness-crm-postgres`.

## 1. Fast gates

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test                                  # unit: shared, web, api
pnpm turbo run openapi:check               # apps/api/openapi.json matches the controllers
pnpm security:audit
```

A format failure: `pnpm format`, then `eslint --fix` in the package, then `pnpm format` again.

## 2. Database suites (one runner at a time)

They share `fitness_crm_test`, `fitness_crm_e2e`, and fixed ports, so only one agent runs them, and never two worktrees at once.

```text
pnpm test:integration
pnpm test:e2e            # builds both apps; includes the security suite and the own-branch project
```

Run the full E2E suite **three times**; a test that fails once is flaky and must be fixed at its cause (no retries, no sleeps).

If a migration changed after it was applied to the test or E2E database, the run fails with a missing column or table. Undo it there by hand — drop what the migration created and `DELETE FROM _prisma_migrations WHERE migration_name = '<name>'` — then run again. Never reset those databases with `migrate reset` while another worktree uses them.

## 3. Migrations on a copy of the dev database

The user's dev database `fitness_crm` holds their real trial data; copy it, never migrate it.

```bash
CHECK=fitness_crm_<slice>check
docker exec fitness-crm-postgres sh -c "psql -q -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE IF EXISTS $CHECK' -c 'CREATE DATABASE $CHECK' && pg_dump -U \"\$POSTGRES_USER\" fitness_crm | psql -q -U \"\$POSTGRES_USER\" -d $CHECK >/dev/null"
cd apps/api
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d'"' -f2 | sed "s#/fitness_crm\$#/$CHECK#; s#/fitness_crm?#/$CHECK?#")"
pnpm exec prisma migrate deploy                                                   # every pending migration applies
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script   # must print nothing
```

Then query what the migration backfilled or seeded (counts per new table, checks that existing rows satisfy new constraints) and note the pending migration names for the report. Drop `$CHECK` when the slice is finished.

## 4. Report

A table: suite → result (counts; E2E runs ×3), plus the migrations applied on the dev copy and whether the diff was empty. Report a failure with its output; never call a gate passed that was skipped.
