# Gym CRM

A management system for gyms and fitness centers with several branches: leads and consulting, customers and contracts,
personal-training schedules and sessions, payments and the cash book, staff tasks, customer emails, and reports. One record
per person, from the first message to the last session.

It is a **sample project**: built for a real gym, then published with every customer detail removed. The gym in the data
is the fictional *Demo Gym*, and every person, phone number and address is invented. The user interface is in Vietnamese
and English.

> The requirements brief that the documentation cites as "brief §n" is not included. The decisions, rules and
> specifications in [`docs/`](docs) carry its content.

## What it does

**Leads and consulting**

- Leads from manual entry and from connected channels: a website form, WhatsApp, Messenger and Instagram, Facebook Lead
  Ads, a forwarded Gmail inbox, and Zalo OA, each with its own key or signed webhook ([docs/31](docs/31_LEAD_INTAKE_API.md)).
- Weighted round-robin assignment, reclaiming untouched leads, a timed consulting checklist with reminders and a lock,
  re-care, a script library, a Kanban board, duplicate-phone warnings and merges.
- Consulting audit: automatic checks and the manager's review, with a consulting dashboard and lead analysis.

**Customers, contracts and money**

- One profile from lead to member; ID numbers and health notes encrypted at rest; files served only through signed links.
- Services priced in tiers, promotions and vouchers; contracts approved before use and locked afterwards (also in the
  database), changed only through change vouchers: renewal, upgrade, hold, transfer, branch transfer, cancellation with
  refund.
- Receipts and expense vouchers with approvals, the cash book, debt always derived from valid receipts, PT payouts.

**Training**

- The PT calendar (rows per trainer, week view), bookings without trainer or customer overlap even under concurrent
  requests, session statuses that consume sessions and credit trainers by configurable rules, classes and attendance.
- Fingerprint check-in through a ZKTeco machine and a small bridge that runs at the gym ([docs/33](docs/33_ZKTECO_BRIDGE.md)).
- Workout plans and session logs with flags, actions and escalation; a progress tab and a weekly workout dashboard.

**Running the business**

- Roles and a permission tree with per-user overrides, data scope, hidden fields, branch access and allowed hours.
- An approval engine and matrix; nobody approves their own request.
- Every change audited with before and after values; deletions go to a trash with a reason; codes are never reused.
- Customer emails from templates in Vietnamese and English through an outbox with retries; staff notifications in the app,
  by email and as web push.
- Reports with Excel export, an import for gyms moving from GymMaster, and a System status page for the owner.

The rule behind all of it: **the flows are fixed in code; every value is configured by Admin on screen** (decision D-015 in
[docs/18](docs/18_DECISIONS_ASSUMPTIONS.md)).

## Technology

| Part | Choice |
|---|---|
| Monorepo | pnpm workspaces and Turborepo, TypeScript strict |
| Web | Next.js (App Router), shadcn/ui and Tailwind, next-intl |
| API | NestJS, REST under `/api/v1` with a committed OpenAPI contract, Better Auth, pg-boss jobs in PostgreSQL |
| Data | PostgreSQL 17 and Prisma; Zod schemas shared by the API and the web app |
| Files, email | Cloudflare R2; Resend (or a log provider in development) |
| Tests | Vitest (unit, and integration against PostgreSQL), Playwright end to end, an OWASP security suite |
| Operations | Docker image for the API and the worker, health and readiness checks, encrypted daily backups, Sentry |

Why each choice was made: [docs/26_TECH_PROPOSAL.md](docs/26_TECH_PROPOSAL.md) and
[docs/22_TECHNICAL_ARCHITECTURE.md](docs/22_TECHNICAL_ARCHITECTURE.md).

## Repository layout

| Path | What it holds |
|---|---|
| `apps/web` | The Next.js app. Pages and Server Actions call the API through a client generated from `openapi.json`; browsers reach the API only through the web app's `/api/*`. |
| `apps/api` | The NestJS API: controllers, services, repositories, the Prisma schema and migrations, background jobs, integration tests. `openapi.json` is the committed contract. |
| `apps/zk-bridge` | Runs at the gym, not on the servers: receives the ZKTeco machine's push on the local network and forwards the punches to the API. |
| `packages/shared` | Zod input and response schemas, permission keys, error codes and pure domain rules, shared by the API and the web app. |
| `packages/config` | ESLint and TypeScript presets. |
| `e2e` | Playwright tests and the OWASP security suite, against both apps. |
| `docs` | Scope, business rules, data model, API and UI specifications, decisions, test strategy, deployment. |

## Running it locally

You need Node.js 22 or later, pnpm 12 (`npm install -g pnpm@12`) and Docker.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # database URLs, auth secret, the first admin
cp apps/web/.env.example apps/web/.env      # where the web app reaches the API
pnpm db:up                                  # PostgreSQL in Docker
pnpm db:deploy                              # migrations
pnpm db:seed                                # the first admin, from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD
pnpm db:seed:demo                           # optional: staff for every role, customers, contracts, bookings
pnpm dev                                    # web on http://localhost:3000, API on :4000 (API docs at /api/docs)
```

Sign in with the admin from `apps/api/.env`. After `db:seed:demo`, every demo staff account (listed when the command ends)
uses the same password as the admin.

## Tests and checks

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test                   # unit tests in every package
pnpm test:integration       # API against PostgreSQL, one database clone per worker
pnpm test:e2e:smoke         # builds both apps, then the main journeys and the OWASP suite (what CI runs)
pnpm test:e2e               # the full end-to-end suite
pnpm security:audit         # dependency vulnerability gate
```

CI (`.github/workflows/ci.yml`) runs these on every push and pull request, and also builds the API's Docker image and
starts it the way a deployment would.

## Deploying

- [docs/15_DEPLOYMENT.md](docs/15_DEPLOYMENT.md): the production layout (web on Vercel; API, worker and PostgreSQL on Render
  or Railway), the settings, backups and restore drills, monitoring, and a go-live checklist.
- [docs/34_TRIAL_DEPLOYMENT.md](docs/34_TRIAL_DEPLOYMENT.md): a free trial setup on Render, Vercel and Cloudflare R2, step by
  step, using [`render.yaml`](render.yaml) and [`apps/web/vercel.json`](apps/web/vercel.json).

## Documentation

| File | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Rules for AI coding agents working on the repository |
| [`docs/00_PROJECT_OVERVIEW.md`](docs/00_PROJECT_OVERVIEW.md) | Product overview and goals |
| [`docs/01_SCOPE_MVP.md`](docs/01_SCOPE_MVP.md) | Phase 1 scope and exclusions |
| [`docs/02_BUSINESS_FLOW.md`](docs/02_BUSINESS_FLOW.md) | Customer journey, consulting, contracts, sessions, money |
| [`docs/03_DOMAIN_MODEL.md`](docs/03_DOMAIN_MODEL.md) | Domain entities |
| [`docs/04_DATA_MODEL_ERD.md`](docs/04_DATA_MODEL_ERD.md) | Data model and database constraints |
| [`docs/05_BUSINESS_RULES.md`](docs/05_BUSINESS_RULES.md) | Business rules |
| [`docs/06_FUNCTIONAL_REQUIREMENTS.md`](docs/06_FUNCTIONAL_REQUIREMENTS.md) | Functional requirements per module |
| [`docs/07_API_SPECIFICATION.md`](docs/07_API_SPECIFICATION.md) | API contract |
| [`docs/08_UI_UX_SPECIFICATION.md`](docs/08_UI_UX_SPECIFICATION.md) | Screens |
| [`docs/09_RBAC.md`](docs/09_RBAC.md) | Roles, permission tree, data scope, approval matrix |
| [`docs/10_REPORTING_DASHBOARD.md`](docs/10_REPORTING_DASHBOARD.md) | Dashboards and reports |
| [`docs/11_NON_FUNCTIONAL_REQUIREMENTS.md`](docs/11_NON_FUNCTIONAL_REQUIREMENTS.md) | Performance, mobile, language, personal data, backups |
| [`docs/12_SECURITY_AUDIT.md`](docs/12_SECURITY_AUDIT.md) | Security, audit log, trash |
| [`docs/13_TEST_STRATEGY.md`](docs/13_TEST_STRATEGY.md) | Test strategy and critical scenarios |
| [`docs/14_ACCEPTANCE_CRITERIA.md`](docs/14_ACCEPTANCE_CRITERIA.md) | Acceptance criteria |
| [`docs/15_DEPLOYMENT.md`](docs/15_DEPLOYMENT.md) | Environments and deployment |
| [`docs/16_IMPLEMENTATION_PLAN.md`](docs/16_IMPLEMENTATION_PLAN.md) | Milestones and progress |
| [`docs/17_AI_AGENT_WORKFLOW.md`](docs/17_AI_AGENT_WORKFLOW.md) | How to brief an AI agent |
| [`docs/18_DECISIONS_ASSUMPTIONS.md`](docs/18_DECISIONS_ASSUMPTIONS.md) | Decisions, assumptions, open questions |
| [`docs/19_FUTURE_ROADMAP.md`](docs/19_FUTURE_ROADMAP.md) | After phase 1 |
| [`docs/20_GLOSSARY.md`](docs/20_GLOSSARY.md) | Vietnamese and English terms |
| [`docs/21_TRACEABILITY_MATRIX.md`](docs/21_TRACEABILITY_MATRIX.md) | Requirement → API → screen → test |
| [`docs/22_TECHNICAL_ARCHITECTURE.md`](docs/22_TECHNICAL_ARCHITECTURE.md) | Layers, transactions, concurrency |
| [`docs/23_UI_DESIGN_SYSTEM.md`](docs/23_UI_DESIGN_SYSTEM.md) | UI design system |
| [`docs/24_SECURITY_TESTING.md`](docs/24_SECURITY_TESTING.md) | OWASP testing |
| [`docs/25_BRIEF_V2_GAP_ANALYSIS.md`](docs/25_BRIEF_V2_GAP_ANALYSIS.md) | What was reused and reworked from an earlier version |
| [`docs/26_TECH_PROPOSAL.md`](docs/26_TECH_PROPOSAL.md) | Technology, architecture, hosting, costs |
| [`docs/27_ESTIMATES.md`](docs/27_ESTIMATES.md) | Effort per milestone |
| [`docs/28_SLICE_PLAN.md`](docs/28_SLICE_PLAN.md) | Every slice with its tests and the decisions settled first |
| [`docs/29_GYMMASTER_IMPORT.md`](docs/29_GYMMASTER_IMPORT.md) | Importing from GymMaster: the workbook, the rules, the cleanup list |
| [`docs/29_PUSH_NOTIFICATION_PROPOSAL.md`](docs/29_PUSH_NOTIFICATION_PROPOSAL.md) | Web push notifications for staff |
| [`docs/30_LEAD_CHANNEL_SURVEY.md`](docs/30_LEAD_CHANNEL_SURVEY.md) | Lead channels: feasibility, cost, review and order |
| [`docs/31_LEAD_INTAKE_API.md`](docs/31_LEAD_INTAKE_API.md) | The lead intake API and the channel webhooks |
| [`docs/33_ZKTECO_BRIDGE.md`](docs/33_ZKTECO_BRIDGE.md) | The ZKTeco bridge: what it does and how to set it up |
| [`docs/34_TRIAL_DEPLOYMENT.md`](docs/34_TRIAL_DEPLOYMENT.md) | A free trial deployment, step by step |
| [`docs/wireframes/gym-crm-wireframes.html`](docs/wireframes/gym-crm-wireframes.html) | Wireframes: leads, PT calendar, workout log, permissions |

A good reading order: decisions ([18](docs/18_DECISIONS_ASSUMPTIONS.md)), then scope, flow and rules
([01](docs/01_SCOPE_MVP.md), [02](docs/02_BUSINESS_FLOW.md), [05](docs/05_BUSINESS_RULES.md)), then architecture
([26](docs/26_TECH_PROPOSAL.md), [22](docs/22_TECHNICAL_ARCHITECTURE.md)), then [`AGENTS.md`](AGENTS.md) for how the code
is written.

## Built with AI agents

Most of the code and documentation was written by AI coding agents working slice by slice under [`AGENTS.md`](AGENTS.md):
each slice with its tests, documentation and decisions. [docs/17](docs/17_AI_AGENT_WORKFLOW.md) describes the workflow.
