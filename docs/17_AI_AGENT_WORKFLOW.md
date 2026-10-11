# 17 — AI Agent Workflow

## How a slice is built

Each slice of `28_SLICE_PLAN.md` is built by two Claude Code agents with separate jobs. The `slice` skill (`.claude/skills/slice/SKILL.md`) orchestrates them:

| Role | Defined in | Owns | Never |
|---|---|---|---|
| Orchestrator (the main session) | `.claude/skills/slice` | The slice brief, decisions with the user, review, docs check, commit and merge | Guesses a business rule |
| Developer | `.claude/agents/slice-dev.md` | `packages/shared`, `apps/api/src` and `prisma`, `apps/web`, unit tests, OpenAPI, docs | Edits integration, E2E, or security tests |
| Test engineer | `.claude/agents/slice-tester.md` | `apps/api/test`, `e2e` (specs, page objects, fixtures, security suite), docs 13 and 24 | Edits product code, or weakens an assertion to pass |

The flow:

1. The orchestrator writes `.slice/brief.md` in a new worktree: the requirement, the rules, the files, the decisions to settle, and the expected tests. Decisions that touch money, sessions, PT pay, or permissions go to the user first.
2. **Phase A:** the developer writes the contract (migration, shared schemas, endpoints with permissions, OpenAPI) and summarizes it in `.slice/contract.md`.
3. **Phase B, in parallel:** the developer builds the behavior. The tester writes tests from the brief and the contract, not from the code, so the tests check the specification rather than repeat the implementation.
4. **Phase C:** the tester runs every suite. It is the only agent that runs the database suites, which share databases and ports. Product bugs go to `.slice/bugs.md`, the developer fixes them, and the tester re-runs.
5. The orchestrator verifies (`.claude/skills/slice-verify`: all gates, plus the migrations on a copy of the dev database), reviews the diff with the review list below, checks the docs, commits, and fast-forwards into local `main`.

## Recommended first prompt

```text
Read AGENTS.md and all documents required by the task.
Treat them as the source of truth.
Do not invent business rules.

The source of truth is docs/source/BRIEF_V2_vi.md and docs/18_DECISIONS_ASSUMPTIONS.md.
The architecture is a monorepo: apps/web (Next.js, UI only) and apps/api (NestJS, all business logic),
PostgreSQL + Prisma, web on Vercel, API on Railway or Render.
Do not add other backends, microservices, Redis, or brokers.
Never hard-code a value the brief marks as admin-configurable.

Before coding:
1. summarize the requirement,
2. list affected business rules,
3. identify ambiguity or risks,
4. propose the implementation plan,
5. then implement the smallest complete vertical slice,
6. add tests,
7. run validation,
8. update documentation if behavior changes.
```

## Task template

```markdown
# Task
Implement: <feature>

## Goal
<business outcome>

## Source of truth
- AGENTS.md
- docs/22_TECHNICAL_ARCHITECTURE.md
- docs/...
- BR-...
- FR-...
- Acceptance criteria ...

## Required behavior
- ...

## Architecture constraints
- apps/web: Next.js App Router, calls the API through the generated client
- apps/api: NestJS controller → service → repository, permission key on every endpoint
- PostgreSQL + Prisma, migrations
- configuration from the database (option lists, parameters, status rules)
- approval matrix, audit with before/after, trash instead of delete

## Out of scope
- ...

## Deliverables
- UI where applicable
- API controller with OpenAPI and permission key
- application/domain service
- repository/data access
- migration if required
- unit/integration tests
- Playwright update when user-visible
- docs update

## Definition of done
- tests pass
- lint/type-check pass
- acceptance criteria pass
- authorization enforced on server
- no unapproved second backend/runtime introduced
```

## Review template

Ask a second agent/review pass:

```text
Review this implementation against AGENTS.md, docs/22_TECHNICAL_ARCHITECTURE.md, and the business rules.
Prioritize:
1. money correctness,
2. session-consumption correctness,
3. authorization,
4. concurrency/idempotency,
5. data consistency,
6. permissions, data scope, masking, and approvals,
7. separation of request/UI handling from business logic,
8. missing tests.
Do not focus on style before correctness.
```

## Anti-patterns

Do not prompt:

```text
Build the complete Flow Fitness CRM.
```

Do not allow the agent to:

- invent status transitions
- store debt as manually editable truth
- decrement sessions on booking
- silently delete payment history
- put financial/session business logic directly in React components
- put business workflows in controllers or in the web app
- access the database from apps/web
- hard-code prices, timers, reasons, statuses, colors, or permissions
- edit an approved contract or hard-delete business data
- add services beyond apps/web, apps/api, and its worker
- merge large unrelated features into one change
