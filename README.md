# Fitness CRM — Markdown Documentation Package

> **Baseline:** Internal CRM for a single gym, V1 without fingerprint integration.
>
> **Architecture baseline:** Full-stack **Next.js + TypeScript** deployed on **Vercel**, with **PostgreSQL + Prisma**. A separate NestJS backend is intentionally excluded from V1.

This repository-ready documentation package is the source of truth for product, engineering, QA, and AI coding agents.

## Product goal

Build a lightweight internal Fitness CRM around three core business flows:

1. **Customer & Contract Management** — each customer has one unique ID and can own multiple contracts.
2. **Operations** — book training sessions, manually check in customers, complete sessions, and consume contract sessions safely.
3. **Finance, Reports & Dashboard** — record payments, debt, income/expense, completed sessions, and show business performance.

## Confirmed technical baseline

- Application: **Next.js + TypeScript** full-stack
- Hosting: **Vercel**
- Database: **PostgreSQL**
- ORM: **Prisma**
- Validation: **Zod**
- UI: **Tailwind CSS + shadcn/ui**, Vietnamese/English via **next-intl** — see `docs/23_UI_DESIGN_SYSTEM.md`
- Authentication: **Better Auth** (T-028)
- Testing: **Vitest (unit + integration against PostgreSQL) + Playwright E2E**
- CI/CD: **GitHub + Vercel deployment workflow**
- PostgreSQL hosting: managed provider with serverless-compatible connection pooling; provider can be selected separately

## V1 architecture

```text
Browser
   |
   v
Vercel
└── Next.js
    ├── React UI
    ├── Server Actions
    ├── Route Handlers (/api/v1/...)
    ├── Application/Domain Services
    └── Repositories
             |
             v
           Prisma
             |
             v
        PostgreSQL
```

Business logic must **not** live in React components, Server Actions, or Route Handlers. Those layers validate/authenticate the request and delegate to application/domain services.

## Documentation map

| File | Purpose |
|---|---|
| `AGENTS.md` | Rules for Codex / AI coding agents |
| `docs/00_PROJECT_OVERVIEW.md` | Product overview and goals |
| `docs/01_SCOPE_MVP.md` | V1 scope and exclusions |
| `docs/02_BUSINESS_FLOW.md` | End-to-end business flows |
| `docs/03_DOMAIN_MODEL.md` | Core domain concepts |
| `docs/04_DATA_MODEL_ERD.md` | Data model and Mermaid ERD |
| `docs/05_BUSINESS_RULES.md` | Hard business rules and state machines |
| `docs/06_FUNCTIONAL_REQUIREMENTS.md` | Functional requirements |
| `docs/07_API_SPECIFICATION.md` | Internal HTTP API contract proposal |
| `docs/08_UI_UX_SPECIFICATION.md` | Screens and interactions |
| `docs/09_RBAC.md` | Roles and permissions |
| `docs/10_REPORTING_DASHBOARD.md` | Reports and dashboard metrics |
| `docs/11_NON_FUNCTIONAL_REQUIREMENTS.md` | Performance, reliability, backup, observability |
| `docs/12_SECURITY_AUDIT.md` | Security and audit requirements |
| `docs/13_TEST_STRATEGY.md` | Test strategy and critical scenarios |
| `docs/14_ACCEPTANCE_CRITERIA.md` | Acceptance criteria for MVP |
| `docs/15_DEPLOYMENT.md` | Vercel deployment and environment strategy |
| `docs/16_IMPLEMENTATION_PLAN.md` | Phased build plan |
| `docs/17_AI_AGENT_WORKFLOW.md` | How to give tasks to an AI agent |
| `docs/18_DECISIONS_ASSUMPTIONS.md` | Decisions, assumptions, unresolved items |
| `docs/19_FUTURE_ROADMAP.md` | Future integrations and expansion |
| `docs/20_GLOSSARY.md` | Domain glossary |
| `docs/21_TRACEABILITY_MATRIX.md` | Requirement → API → UI → test mapping |
| `docs/22_TECHNICAL_ARCHITECTURE.md` | Full-stack Next.js architecture and coding boundaries |
| `docs/23_UI_DESIGN_SYSTEM.md` | UI library, design tokens, shared components, languages, formatting |
| `docs/24_SECURITY_TESTING.md` | OWASP Top 10:2025 controls, security tests, dependency gate |
| `CHANGELOG.md` | Documentation package changes |

## Run it locally

Requirements: Node.js 22+, Docker Desktop.

```text
npm install
cp .env.example .env          # local values; set a real BETTER_AUTH_SECRET
npm run db:up                 # PostgreSQL 17 in Docker (dev, test, and e2e databases)
npm run db:migrate            # apply migrations to the dev database
npm run db:seed               # first admin, from SEED_ADMIN_* in .env
npm run dev                   # http://localhost:3000
```

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`, `npm run security:audit`, `npm run test:security`.

## Start here

1. Read `AGENTS.md`.
2. Read `docs/00_PROJECT_OVERVIEW.md` through `docs/05_BUSINESS_RULES.md`.
3. Read `docs/22_TECHNICAL_ARCHITECTURE.md` before implementing infrastructure or modules.
4. Confirm unresolved items in `docs/18_DECISIONS_ASSUMPTIONS.md`.
5. Implement in the order defined in `docs/16_IMPLEMENTATION_PLAN.md`.
6. Do not implement out-of-scope features unless the source-of-truth documents are updated first.
