# 27 — Estimates

The time and cost per milestone the brief asks for (brief §12). Effort is for **one senior full-stack developer working with an AI coding agent**, the way Phases 0–4 were built. Ranges are honest bounds, not quotes; they are refined at the start of each milestone.

## Assumptions

- One developer, full time (5 days a week), with an AI coding agent for implementation and tests; the developer designs, reviews, tests on staging, and talks to the owner.
- Includes for each milestone: design, code, unit, integration, E2E, and security tests, migrations, docs, deployment to staging, and one round of fixes after the owner's trial.
- Excludes waiting time outside the developer's control (owner answers to open questions, Meta/WhatsApp/Zalo app reviews, legal advice) and the owner's own work (price tiers, templates, option lists, data cleanup sign-off).
- Volumes per A-028. Reuses the Phases 0–4 code as listed in `25_BRIEF_V2_GAP_ANALYSIS.md`.
- A contingency of 15% is added to the total.

## Effort per milestone

| # | Milestone | Person-weeks | Main drivers |
|---|---|---|---|
| M1 | Foundation | 4–6 | Monorepo restructure without breaking the built features; permission tree with scope, masks, overrides; approval engine; configuration and option lists; trash and audit everywhere; tasks and notifications |
| M2 | Leads and consulting | 3–4 | Timed checklist with jobs, Kanban, re-care, duplicate merge, convert to customer, phone-first screens |
| M3 | Audit and consulting dashboard | 1.5–2 | Compliance scoring; reconciliation against the September/October Excel files (AC-08) |
| M4 | Contracts and cash book | 4–5 | Tiers with versions, exception price, approvals, deletion order, freezes with extension, receipts, expense vouchers, cash book; reuse of contract and payment services |
| M5 | PT schedule, classes, sessions | 4–5 | Configurable statuses with snapshots, customer overlap, working schedules, week view, bulk check-in, deletion with refund and payroll adjustment, Burn Show, classes, PT revenue report matching GymMaster (AC-18), payouts |
| M6 | Customer email | 1–1.5 | Provider setup and domain authentication, outbox, templates in two languages |
| M7 | Workout plans and logs | 3–4 | Catalogs, templates, plan editor, phone-first session log, escalation, progress charts, weekly dashboard |
| M8 | Contract change vouchers | 2–3 | Seven voucher kinds and their effects on sessions, dates, value, and money |
| M9 | Remaining reports and import | 3–4 | Overview dashboard and exports; GymMaster and Excel import with cleanup list, staging trial, reconciliation, parallel run |
| M10 | Lead channel APIs | 2–4 | Depends on which channels pass the survey (TS-007); WhatsApp Business first |
| M11 | AI-assisted audit | 1.5–3 | De-identification, prompt design against the scripts, evaluation with managers (TS-008) |
| | **Subtotal** | **29–41.5** | |
| | **With 15% contingency** | **33–48** | About **8–11 months** for one developer |

M1–M5 (the core: platform, leads, contracts and money, schedule) is 16.5–22 person-weeks (19–25 with contingency), about 4.5–6 months. That is the earliest point at which GymMaster can be replaced, once M9's import is pulled forward or done manually.

## Calendar

Milestones run in order. Each ends with a week of the owner's trial on staging, overlapping the next milestone. Open questions per milestone (`16_IMPLEMENTATION_PLAN.md`) should be answered before the milestone starts to avoid rework.

## Running costs per month

From `26_TECH_PROPOSAL.md` §7 (USD, list prices to confirm, excluding VAT; about 25,500 VND per USD):

| Item | Staging | Production |
|---|---|---|
| Vercel Pro (web) | included | $20 |
| Railway or Render: API, worker, PostgreSQL | $10–20 | $30–60 |
| Email (Resend / Amazon SES) | $0 | $20 / about $1 |
| Cloudflare R2 storage | $0 | $0–5 |
| Sentry, domain | $0 | about $2 |
| **Total** | **$10–20** | **$55–110** |

Both environments together cost about $65–130 per month (about 1.7–3.3 million VND).

## Costs that depend on later decisions

| Item | Estimate | Decided by |
|---|---|---|
| WhatsApp Business API | Meta's per-conversation fees; business-initiated conversations cost more than replies within 24 hours. Likely tens of USD per month at the current lead volume. | TS-007, before M10 |
| Other channel APIs (Messenger, Instagram, Zalo OA for intake) | Usually free API access; app review effort | TS-007 |
| AI-assisted audit | Pay-per-use language model; roughly $0.01–0.05 per lead audited, so about $10–50 per month for 1,000 leads | TS-008, OQ-025 |
| Development tooling (AI coding agent subscription) | About $100–200 per month during development | Developer |
| Admin two-factor, extra monitoring | $0 (built-in or free tiers) | TS-004 |
