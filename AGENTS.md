# AGENTS.md — Instructions for AI Coding Agents

This file is authoritative for any AI agent working on the Flow Fitness CRM repository.

## 1. Source of truth

Before coding, read:

1. `README.md`
2. `docs/source/BRIEF_V2_vi.md` — the customer's brief (cited as brief §n)
3. `docs/18_DECISIONS_ASSUMPTIONS.md`
4. `docs/01_SCOPE_MVP.md`, `docs/02_BUSINESS_FLOW.md`, `docs/05_BUSINESS_RULES.md`
5. `docs/22_TECHNICAL_ARCHITECTURE.md` and `docs/26_TECH_PROPOSAL.md`
6. `docs/23_UI_DESIGN_SYSTEM.md` for any task that touches the UI
7. `docs/25_BRIEF_V2_GAP_ANALYSIS.md` when changing code built before brief v2
8. The feature-specific documentation relevant to the task

If requirements conflict, use this priority:

1. The brief and the confirmed decisions in doc 18
2. Explicit business rules (doc 05)
3. Acceptance criteria (doc 14)
4. Functional requirements (doc 06)
5. API/UI specification (docs 07, 08)
6. Technical architecture (docs 22, 26)
7. Implementation notes

Do **not** invent business rules. Add unknowns to `docs/18_DECISIONS_ASSUMPTIONS.md` and stop the affected part of implementation if the ambiguity can change money, session consumption, PT pay, or permissions.

In `docs/18_DECISIONS_ASSUMPTIONS.md`:

- confirmed decisions (D-xxx, T-xxx) are binding; an entry marked *Superseded by …* is not;
- working assumptions (A-xxx) may be implemented, and must be cited where they are used;
- open questions (OQ-xxx) block the part named in their *Blocks* column. Build only the *Interim* behavior until the question is answered.

## 2. Phase 1 constraints

- Multi-branch from day one: every business record belongs to a branch (D-014).
- **Fixed flow, configurable values** (D-015): never hard-code a value the brief marks as admin-configurable (channels, sources, reasons, prices, tiers, durations, timers, thresholds, roles, permissions, approval matrix, status rules and colors, rates, Flags, Actions, expense types, email templates, code prefixes). Numbers in the brief are seed values.
- **Drop-downs, not free text** (D-016): results, statuses, categories, and reasons come from admin option lists, each with "Khác" that requires a note.
- Architecture (T-041): a monorepo with `apps/web` (Next.js, UI only) and `apps/api` (NestJS, all business logic and data access). Do not add other backends, microservices, Redis, or message brokers; background work uses pg-boss in PostgreSQL (T-045).
- Hosting (T-042): web on Vercel; API, worker, and PostgreSQL on Railway or Render; staging separate from production.
- No fingerprint devices attached in phase 1 (the scan API, pairing rules, and data are built ready in M5, D-069 to D-072), and no member app, Zalo OA, Pro Shop, lockers, loyalty, day passes, or tax accounting in phase 1 (D-013). Lead channel APIs only in milestone 10 (D-044); manual entry first.
- Email is the only notification channel to customers (D-036).

## 3. Critical invariants

- One person, one record: a lead becomes a customer at Show with the same ID; duplicate phones warn and merge, never duplicate (D-019).
- A contract is effective only after approval. **Approved contracts are never edited**, even by admin; changes go through change vouchers; a wrong contract is deleted (receipts first) and re-created (D-022, D-024).
- A booking needs an approved, active contract with sessions left, not expired, not frozen; no trainer overlap and no customer overlap, also under concurrent requests (D-030, T-014).
- Session status rules come from configuration (D-025). Initially *Đã tập*, no-show, and Burn Show consume one session and credit the PT; *Hủy lịch* and deleted sessions do not. Each session stores the flags of the rule applied when its status was set (T-050).
- *Đã tập* is locked once set. The only correction is deleting the session from the check-in history: reason required, one session refunded, PT credit removed, trash, customer email, and a payroll adjustment when the period was already paid (D-026, D-027).
- Sessions left and sessions used are always derived from sessions and change vouchers, never typed (T-050). Repeating a status change must not consume twice, including under concurrent requests (locked transaction, `docs/22_TECHNICAL_ARCHITECTURE.md` §7).
- Paid amount and debt are always derived from valid receipts (approved, not deleted), plus imported opening balances (D-011, D-034).
- Pending approvals have no effect, and nobody approves their own submission (D-018).
- No hard delete of business data: deletions go to the trash with a mandatory reason; codes and voucher numbers are never reused (D-035, D-038).
- Every create, update, delete, approval, and configuration or permission change is audited with before/after values (T-048).
- Every change in a customer's session count sends one customer email (D-036).

## 4. Engineering rules

- TypeScript strict mode everywhere.
- Code is formatted by Prettier (`prettier.config.mjs`: 120-character lines, Tailwind classes sorted) and linted with the readability rules in `packages/config/eslint.mjs`. Run `pnpm format` before committing; CI runs `pnpm format:check`.
- Validate all external input at the API boundary with Zod schemas shared from `packages/shared`.
- Every endpoint declares a permission key and is checked by the API guards: effective permissions, branch access, login hours, data scope, field masking (T-046). Hiding UI is never authorization. Controllers declare `@RequirePermission(...)` or `@AnySignedInUser()`; services check data scope and branches through `platform/permissions` (T-054), and the web hides UI from the permissions `GET /me` returns.
- Use database transactions for operations that change more than one record; keep lock order contract → session/booking (T-013, T-036, T-040, T-050).
- Creates of contracts, receipts, expense vouchers, and change vouchers require an idempotency key (T-015).
- Never trust client-calculated debt, sessions left, payment state, prices, or permissions.
- Keep controllers thin; business logic lives in services; Prisma only in repositories inside `apps/api`.
- `apps/web` never imports Prisma or server-side services; it calls the API through the generated client (T-043), from Server Components and Server Actions. Browsers reach the API only through the web app's `/api/*` (T-053). `apps/web/src/lib/security/api-boundary.test.ts` enforces this.
- Every API response is encoded with its response schema from `packages/shared` (`encode(schema, value)`); the web decodes with the same schema. After changing a controller or schema, run `pnpm --filter api build && pnpm --filter api openapi` and commit `apps/api/openapi.json`; CI fails when it is out of date.
- Use migrations; never schema push in shared environments.
- Every critical change requires tests: unit, integration against PostgreSQL, and E2E where users see it.

Security rules (full context in `docs/24_SECURITY_TESTING.md`):

- Authenticate every API request; authorize inside services and guards; log denials with `logSecurityEvent`.
- Validate every free-text field with `hasNoControlCharacters`.
- Never log passwords, cookies, tokens, hashes, ID numbers, or health data.
- Encrypt ID-document numbers and health data at rest; serve files only through signed URLs (D-042, T-052).
- Do not weaken the CSP, the Origin check, or the security headers without updating doc 24 and doc 18.
- A new high/critical dependency advisory is fixed or triaged into `security/audit-allowlist.json`; never silenced.
- Every new endpoint gets its OWASP tests (access control, data scope, masking, input errors) in the same change.

UI rules (full rules in `docs/23_UI_DESIGN_SYSTEM.md` §12):

- Build screens only from shadcn/ui components in `apps/web/src/components/ui/` and the shared components listed in doc 23 §8.
- Use the shared list template (filters on the left, search, table with paging and totals row, Add, Export Excel).
- Use design tokens; status colors come from configuration through `StatusBadge`, never raw palette classes or hex values.
- Every user-facing string goes in both `vi` and `en` message files; never hard-code text.
- Format money and dates only through `Money` / `DateTime` (VND, `dd/MM/yyyy`, 24-hour, gym timezone).
- Leads, the PT calendar, and the workout log must work at phone width.

## 5. Source structure

```text
apps/
├── web/                      # Next.js: routes, components, i18n messages
│   └── src/lib/api/          # typed API client (generated from apps/api/openapi.json) and one module per area
└── api/                      # NestJS
    ├── src/platform/         # auth, http (guards, errors, OpenAPI), db, permissions, roles, branches, options, parameters, audit, trash, approvals, notifications;
    │                         # later files. Background jobs: src/jobs.ts and src/worker.ts (T-059)
    ├── src/modules/          # leads, consulting, customers, services, contracts, contract-changes,
    │                         # schedule, classes, workouts, cashbook, tasks, mail, employees, reports
    ├── test/                 # integration tests against PostgreSQL
    ├── prisma/               # schema, migrations, seeds
    └── openapi.json          # the committed API contract (docs/07)
packages/
├── shared/                   # Zod input and response schemas, permission keys, error codes, pure domain rules
└── config/                   # lint and TypeScript presets
e2e/                          # Playwright E2E and the OWASP security suite
docs/
```

Inside an API module: `*.controller.ts` → `*.service.ts` → `*.repository.ts`, with `*.schema.ts` (inputs), `*.view.ts` (responses), and `*.domain.ts` (pure rules) in `packages/shared`, and tests next to the code. Relative imports in `apps/api` and `packages/shared` end in `.js` (ES modules).

## 6. Required task workflow

For each task:

1. Summarize the requirement and cite the brief section.
2. Identify affected rules, decisions, and open questions.
3. List files/modules to change.
4. Identify ambiguity or risks.
5. Implement the smallest complete vertical slice.
6. Add unit/integration tests.
7. Add/update Playwright tests where user-visible behavior changes.
8. Run lint, type-check, tests, and migrations.
9. Update docs when behavior changes.

## 7. Definition of done

A task is done only when:

- Its acceptance criteria (doc 14) pass.
- No critical invariant is violated.
- Tests are added and green.
- Error paths are handled.
- Authorization, data scope, and masking are enforced in the API.
- Audit, trash, and email behavior exist where required.
- No configurable value is hard-coded.
- Documentation remains consistent with the implementation.

## 8. Commands and conventions

From the repository root (pnpm 12; tasks run through Turborepo, which builds `packages/shared` and generates the Prisma client and API types first):

```text
pnpm dev                  # shared (watch), API on :4000, web on :3000
pnpm db:up                # PostgreSQL in Docker
pnpm db:migrate           # create/apply a migration (prisma migrate dev, in apps/api)
pnpm db:seed              # first admin; pnpm db:seed:demo adds demo data (local only)
pnpm typecheck
pnpm lint
pnpm format               # Prettier on the whole repository; pnpm format:check only checks
pnpm test                 # unit (Vitest) in every package
pnpm test:integration     # API integration tests: TEST_DATABASE_URL, cloned per worker (INTEGRATION_WORKERS, default 4)
pnpm test:e2e             # builds both apps, then Playwright against E2E_DATABASE_URL
pnpm test:e2e:smoke       # builds, then the cases tagged @smoke plus the OWASP security suite (what CI runs on every push)
pnpm test:security        # builds, then the OWASP security suite
pnpm security:audit       # dependency vulnerability gate
pnpm turbo run openapi:check   # apps/api/openapi.json matches the controllers
pnpm build
```

One package: `pnpm --filter api <script>` or `pnpm --filter web <script>`. Settings: `apps/api/.env` and `apps/web/.env` (copy the `.env.example` next to each).

- Services take an `Actor` (user, effective permissions, branches) and authorize with the permission guard and `assertCan`.
- Every signed-in page and layout in the web app sets `export const instant = false` (T-029).
- Database objects Prisma cannot model (sequences, exclusion constraints) go into the migration SQL by hand.
- Every change to a contract's sessions or money locks the contract first, then the session or voucher (T-036, T-040, T-050).
- E2E specs follow the structure in `docs/13_TEST_STRATEGY.md`.

The block below is maintained by Next.js and must stay.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
