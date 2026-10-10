# 11 — Non-Functional Requirements

## Performance

For normal internal usage:

- common list/search API p95 target: < 500 ms under expected load
- booking calendar initial load target: < 2 seconds
- dashboard target: < 2 seconds for standard date range

These are V1 targets, not hard external SLAs.

## Reliability

- All session-consumption operations must be transactional.
- All finance mutations must be durable.
- Critical write endpoints must be safe from accidental duplicate submission:
  - creating a contract, payment, or cash transaction requires an idempotency key (T-015);
  - status transitions are idempotent by state;
  - session completion and trainer overlap stay correct under concurrent requests (`22_TECHNICAL_ARCHITECTURE.md` §7, T-014).

## Backup

- Daily PostgreSQL backup minimum.
- Keep a documented restoration procedure.
- Test restore before production launch.

## Observability

Minimum production visibility:

- application error logs
- API request/error logs
- database health
- deployment logs
- audit events for critical domain actions

## Timezone

Store timestamps in UTC where practical; display using the gym's configured local timezone.

- The gym timezone is set by `GYM_TIMEZONE`, default `Asia/Ho_Chi_Minh` (A-001).
- "Today", dashboard periods, report date ranges, and contract expiry are calculated in the gym timezone, not the server's timezone (Vercel runs in UTC).
- Datetime columns are `timestamptz` (`04_DATA_MODEL_ERD.md`).

## Maintainability

- modular domain structure
- typed API contracts
- migration-based database changes
- no business logic hidden in UI components

## Browser support

Latest stable Chrome/Edge should be the minimum for internal gym PCs. Add wider support only if business requires it.

Screen sizes follow A-012: desktop-first, every screen usable at tablet width, and the trainer's day view and check-in/complete actions usable on a phone.

## Localization

- The UI is available in Vietnamese and English; the default is Vietnamese (T-027, A-011).
- Each user's language is stored on their account, so shared PCs show each user their own language.
- Dates, times, and money use the same formats in both languages (`23_UI_DESIGN_SYSTEM.md` §5).

## Accessibility

- All functions are usable with the keyboard.
- Text and controls meet WCAG AA color contrast.
- Status is never shown by color alone; it always has a text label.

## Vercel runtime constraints

- V1 is deployed as a full-stack Next.js application on Vercel.
- Do not rely on mutable in-memory state surviving between requests.
- PostgreSQL connection handling must be compatible with serverless/elastic execution.
- Long-running or durable background processing is out of scope unless the architecture is explicitly revised.
- Route Handlers and Server Actions should remain thin and delegate business rules to services.
