# AGENTS.md — Instructions for AI Coding Agents

This file is authoritative for any AI agent working on the Fitness CRM repository.

## 1. Source of truth

Before coding, read:

1. `README.md`
2. `docs/01_SCOPE_MVP.md`
3. `docs/02_BUSINESS_FLOW.md`
4. `docs/05_BUSINESS_RULES.md`
5. `docs/22_TECHNICAL_ARCHITECTURE.md`
6. `docs/23_UI_DESIGN_SYSTEM.md` for any task that touches the UI
7. The feature-specific documentation relevant to the task

If requirements conflict, use this priority:

1. Explicit business rules
2. Acceptance criteria
3. Functional requirements
4. API/UI specification
5. Technical architecture
6. Implementation notes

Do **not** invent business rules. Add unknowns to `docs/18_DECISIONS_ASSUMPTIONS.md` and stop the affected part of implementation if the ambiguity can change financial or session-consumption behavior.

In `docs/18_DECISIONS_ASSUMPTIONS.md`:

- confirmed decisions (D-xxx, T-xxx) are binding;
- working assumptions (A-xxx) may be implemented, and must be cited where they are used;
- open questions (OQ-xxx) block the part named in their *Blocks* column. Build only the *Interim* behavior until the question is answered.

## 2. V1 constraints

- Single internal gym.
- No multi-tenant SaaS architecture.
- No fingerprint device integration in V1.
- Check-in is manual by an authorized user.
- No mobile app in V1.
- No social inbox integration in V1.
- No automatic no-show penalty in V1.
- V1 uses a **single full-stack Next.js application**.
- V1 is deployed to **Vercel**.
- Do **not** introduce NestJS, Express, Railway, a separate API application, microservices, or Redis unless explicitly approved and the documentation is updated first.

## 3. Critical invariants

- A customer has one immutable unique customer ID.
- One customer can have many contracts.
- Booking does **not** consume a session.
- Manual check-in does **not** consume a session.
- Only transition to `COMPLETED` consumes exactly one session.
- The booking status is the only source of truth for consumption: completed sessions = the contract's bookings in `COMPLETED`.
- Repeating `COMPLETED` on an already completed session must be idempotent and must not consume again.
- These session rules must hold under concurrent requests, not only sequential retries. Follow the locked transaction in `docs/22_TECHNICAL_ARCHITECTURE.md` §7.
- `CANCELLED` and `NO_SHOW` do not consume sessions in V1.
- Contract debt is derived from contract value minus confirmed payments, minus the opening paid amount for contracts imported at go-live (D-011). Imported opening balances are never edited.
- Financial records and completed sessions must be auditable.

## 4. Engineering rules

- Use TypeScript strict mode.
- Use the Next.js App Router.
- Validate all external input at the server boundary, preferably with Zod.
- Authenticate and authorize all protected server mutations.
- Use database transactions for operations that change more than one business record.
- Never trust client-calculated debt, remaining sessions, payment state, or authorization state.
- Keep React components presentation-focused.
- Keep Server Actions and Route Handlers thin; they must delegate business logic to application/domain services.
- Do not access Prisma directly from client components.
- Prefer repository/data-access modules instead of scattering Prisma queries throughout the app.
- Use migrations; do not rely on schema push in production.
- Every critical mutation requires tests.
- Every critical mutation that affects sessions or money must write an audit event.
- Design database access for Vercel/serverless execution and use a serverless-compatible PostgreSQL connection strategy.

Security rules (full context in `docs/24_SECURITY_TESTING.md`):

- Wrap every Route Handler in `handleApi` and authenticate with `requireApiUser`; start every Server Action with `requireActionUser()`. Tests fail otherwise.
- Authorize inside services with `assertCan` from `@/lib/permissions/assert`; never rely on hiding UI.
- Validate every free-text field with `hasNoControlCharacters`.
- Never log passwords, cookies, tokens, or hashes; use `logSecurityEvent` for security-relevant events.
- Do not weaken the CSP, the API Origin check, or the security headers without updating doc 24 and doc 18.
- A new high/critical dependency advisory is fixed or triaged into `security/audit-allowlist.json`; never silenced.
- Every new route or action gets its OWASP tests (access control, input errors) in the same change.

UI rules (full rules in `docs/23_UI_DESIGN_SYSTEM.md` §12):

- Build screens only from shadcn/ui components in `src/components/ui/` and the shared components listed in doc 23 §8. Do not add another UI, styling, icon, or calendar library.
- Use design tokens and component variants; never raw palette classes or hex colors.
- Every user-facing string goes in both `messages/vi.json` and `messages/en.json`; never hard-code text.
- Format money and dates only through `Money` / `DateTime` (VND, `dd/MM/yyyy`, 24-hour, gym timezone).
- Do not create a second toast, error, loading, pagination, or status-badge implementation.

## 5. Preferred source structure

```text
messages/
├── vi.json
└── en.json
src/
├── app/
│   ├── (auth)/
│   ├── (crm)/
│   └── api/v1/
├── components/
│   └── ui/          # generated shadcn/ui components
├── i18n/
├── modules/
│   ├── customers/
│   ├── contracts/
│   ├── bookings/
│   ├── sessions/
│   ├── trainers/
│   ├── finance/
│   └── reporting/
├── lib/
│   ├── auth/
│   ├── db/
│   ├── errors/
│   ├── permissions/
│   └── validation/
└── generated/
```

Within a module, prefer boundaries such as:

```text
modules/sessions/
├── session.service.ts
├── session.repository.ts
├── session.schema.ts
├── session.errors.ts
└── session.test.ts
```

The exact filenames may evolve, but the separation of UI/request handling, business services, and data access must remain clear.

## 6. Required task workflow

For each task:

1. Summarize the requirement.
2. Identify affected domain rules.
3. List files/modules to change.
4. Identify ambiguity or risks.
5. Implement the smallest complete vertical slice.
6. Add unit/integration tests.
7. Add/update Playwright tests where user-visible behavior changes.
8. Run lint, type-check, tests, and migrations.
9. Update docs when behavior changes.

## 7. Definition of done

A task is done only when:

- Acceptance criteria pass.
- No critical business invariant is violated.
- Tests are added and green.
- Error paths are handled.
- Authorization is enforced server-side.
- Audit behavior exists where required.
- Documentation remains consistent with implementation.
- The implementation does not introduce an unapproved second backend/runtime.

## 8. Commands and conventions

```text
npm run db:up             # PostgreSQL in Docker
npm run db:migrate        # create/apply a migration (prisma migrate dev)
npm run db:seed:demo      # demo data for manual testing (local dev database only, after db:seed)
npm run typecheck         # next typegen + tsc
npm run lint
npm test                  # unit (Vitest)
npm run test:integration  # integration against TEST_DATABASE_URL
npm run test:e2e          # builds, then Playwright against E2E_DATABASE_URL
npm run test:security     # builds, then the OWASP security suite
npm run security:audit    # dependency vulnerability gate
npm run build
```

- Services take an `Actor` and authorize themselves with `assertCan`; Server Actions and Route Handlers only authenticate, call the service, and map errors (`runAction`, `handleApi`).
- Every signed-in page and layout sets `export const instant = false` (T-029).
- Database objects Prisma cannot model (sequences, exclusion constraints) go into the migration SQL by hand; Prisma leaves them alone.
- Every booking change locks its contract, then the booking (`lockBooking` in `booking.repository.ts`, T-036); recording or voiding a payment locks its contract too (T-040). New code that changes a contract's bookings, sessions, or money takes the same locks in the same order.
- E2E specs follow the structure in `docs/13_TEST_STRATEGY.md`.

The block below is maintained by Next.js and must stay.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
