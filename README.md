# Flow Fitness CRM — Documentation and Code

> **Baseline:** Flow Fitness's own CRM, replacing GymMaster: one record per person from lead to contract, sessions, cash book, and reports, for several branches. Phase 1 has 12 modules and is the first part of a larger ERP.
>
> **Architecture baseline:** a TypeScript monorepo with **`apps/web` (Next.js)** on Vercel and **`apps/api` (NestJS)** on Railway or Render, with **PostgreSQL + Prisma**.

The customer's brief, `docs/source/BRIEF_V2_vi.md` (10/10/2026), is the source of truth. This package turns it into rules, specifications, and plans for developers and AI coding agents.

## Product goal

Manage the whole customer journey in one system:

1. **Leads and consulting:** capture leads from every channel, assign them, follow a timed consulting checklist, re-care, audit.
2. **Customers and contracts:** one profile from lead to member; contracts priced from service tiers, approved before use, locked after approval, changed only through change vouchers.
3. **Operations:** PT schedule and classes, session statuses that consume sessions and credit trainers, workout plans and session logs with escalation.
4. **Money and work:** cash book of receipts and expense vouchers, PT payouts, tasks between departments, customer emails.
5. **Reports:** dashboards for consulting, workouts, contracts, sessions, money, and tasks.

Principle: **the flows are fixed in code; every value is configured by admin on screen** (D-015).

## Technical baseline

- Monorepo: pnpm workspaces + Turborepo, TypeScript strict
- Web: Next.js App Router, shadcn/ui + Tailwind, next-intl (Vietnamese, English-ready)
- API: NestJS, REST `/api/v1` with OpenAPI, Better Auth, pg-boss jobs
- Database: PostgreSQL + Prisma
- Email: transactional provider (Resend or Amazon SES); files: Cloudflare R2
- Testing: Vitest (unit + integration against PostgreSQL), Playwright E2E, OWASP security suite
- Hosting: Vercel (web), Railway or Render in Singapore (API, worker, PostgreSQL); staging and production
- CI/CD: GitHub Actions in the owner's repository

See `docs/26_TECH_PROPOSAL.md`.

## Current state of the code

Phases 0–4 of the first brief are built as a single Next.js app in `src/`: customers, contracts, PT bookings and sessions, payments, and income/expense, with tests. Brief v2 changes much of this. `docs/25_BRIEF_V2_GAP_ANALYSIS.md` lists what is reused and what is reworked, and milestone M1 restructures the code into the monorepo.

## Documentation map

| File | Purpose |
|---|---|
| `AGENTS.md` | Rules for AI coding agents |
| `docs/source/BRIEF_V2_vi.md` | The customer's brief (Vietnamese, verbatim) |
| `docs/00_PROJECT_OVERVIEW.md` | Product overview and goals |
| `docs/01_SCOPE_MVP.md` | Phase 1 scope and exclusions |
| `docs/02_BUSINESS_FLOW.md` | Customer journey, consulting, contracts, sessions, money |
| `docs/03_DOMAIN_MODEL.md` | Domain entities |
| `docs/04_DATA_MODEL_ERD.md` | Detailed data model and database constraints |
| `docs/05_BUSINESS_RULES.md` | Business rules |
| `docs/06_FUNCTIONAL_REQUIREMENTS.md` | Functional requirements per module |
| `docs/07_API_SPECIFICATION.md` | API contract |
| `docs/08_UI_UX_SPECIFICATION.md` | Screens |
| `docs/09_RBAC.md` | Roles, permission tree, data scope, approval matrix |
| `docs/10_REPORTING_DASHBOARD.md` | Dashboards and reports |
| `docs/11_NON_FUNCTIONAL_REQUIREMENTS.md` | Performance, mobile, language, personal data, backups |
| `docs/12_SECURITY_AUDIT.md` | Security, audit log, trash |
| `docs/13_TEST_STRATEGY.md` | Test strategy and critical scenarios |
| `docs/14_ACCEPTANCE_CRITERIA.md` | Acceptance criteria (brief §12) |
| `docs/15_DEPLOYMENT.md` | Environments and deployment |
| `docs/16_IMPLEMENTATION_PLAN.md` | Milestones M1–M11 |
| `docs/17_AI_AGENT_WORKFLOW.md` | How to brief an AI agent |
| `docs/18_DECISIONS_ASSUMPTIONS.md` | Decisions, assumptions, open questions |
| `docs/19_FUTURE_ROADMAP.md` | After phase 1 |
| `docs/20_GLOSSARY.md` | Vietnamese ↔ English terms |
| `docs/21_TRACEABILITY_MATRIX.md` | Brief → requirement → API → screen → test |
| `docs/22_TECHNICAL_ARCHITECTURE.md` | Layers, transactions, concurrency |
| `docs/23_UI_DESIGN_SYSTEM.md` | UI design system |
| `docs/24_SECURITY_TESTING.md` | OWASP testing |
| `docs/25_BRIEF_V2_GAP_ANALYSIS.md` | What is built vs brief v2 |
| `docs/26_TECH_PROPOSAL.md` | Technology, architecture, hosting, costs |
| `docs/27_ESTIMATES.md` | Effort and cost per milestone |
| `docs/wireframes/flow-fitness-wireframes.html` | Wireframes: leads, PT calendar, workout log, permissions |

## Recommended reading order

1. `docs/source/BRIEF_V2_vi.md`
2. `docs/18_DECISIONS_ASSUMPTIONS.md`
3. `docs/01_SCOPE_MVP.md`, `docs/02_BUSINESS_FLOW.md`, `docs/05_BUSINESS_RULES.md`
4. `docs/26_TECH_PROPOSAL.md`, `docs/22_TECHNICAL_ARCHITECTURE.md`
5. `docs/16_IMPLEMENTATION_PLAN.md`, `docs/25_BRIEF_V2_GAP_ANALYSIS.md`
6. `AGENTS.md`
