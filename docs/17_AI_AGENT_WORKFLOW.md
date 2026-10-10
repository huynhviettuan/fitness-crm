# 17 — AI Agent Workflow

## Recommended first prompt

```text
Read AGENTS.md and all documents required by the task.
Treat them as the source of truth.
Do not invent business rules.

The V1 architecture is a single full-stack Next.js application deployed on Vercel with PostgreSQL + Prisma.
Do not introduce NestJS, Express, Railway, microservices, or another backend unless explicitly approved.

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
- Next.js App Router
- Vercel deployment target
- PostgreSQL + Prisma
- thin Server Action / Route Handler
- business logic in application/domain service
- repository/data-access boundary

## Out of scope
- ...

## Deliverables
- UI where applicable
- server action/route handler where applicable
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
6. Vercel/serverless database safety,
7. separation of request/UI handling from business logic,
8. missing tests.
Do not focus on style before correctness.
```

## Anti-patterns

Do not prompt:

```text
Build the complete Fitness CRM.
```

Do not allow the agent to:

- invent status transitions
- store debt as manually editable truth
- decrement sessions on booking
- silently delete payment history
- put financial/session business logic directly in React components
- put large business workflows directly in Route Handlers or Server Actions
- call Prisma directly from client components
- introduce NestJS/Railway because it is familiar to the model
- merge large unrelated features into one change
