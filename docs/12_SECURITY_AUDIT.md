# 12 — Security & Audit

## Authentication

- Hash passwords using a modern password hashing algorithm.
- Do not log plaintext passwords or tokens.
- Use secure session/token storage.
- Support account disablement. A disabled account loses access on its next request, including sessions that are already signed in (T-017).
- Sessions expire after 12 hours without activity; reception PCs are shared (T-028).
- Sign-in is rate-limited per IP address. The limit (20 per minute) allows for every gym PC sharing one public IP.
- A failed sign-in shows the same message whatever the reason, so the form never reveals which accounts exist.
- Resetting a user's password signs them out on every device.

## Authorization

Every backend mutation must enforce permissions. Frontend hiding alone is not authorization.

## Data validation

Validate:

- identifiers
- money values
- dates and time ranges
- status transitions
- ownership/reference consistency

## Financial safety

- Do not trust frontend debt calculations.
- Payment void/correction must be controlled and audited.
- Prefer append/void patterns over silently deleting financial history.
- Voiding a payment or cash transaction requires a reason (A-008, A-009).
- Duplicate submission of a payment must not record it twice (T-015).

## Session safety

- Completion must be transactional and idempotent, including under concurrent requests.
- Prevent negative remaining sessions, including under concurrent completions.
- Keep completion actor and timestamp.

## Audit events

At minimum audit:

- customer create/update
- contract create/status change/value change
- booking create/reschedule/cancel/no-show
- check-in
- completion
- payment create/void
- cash transaction create/void
- user/role changes

Audit event fields:

- actor
- action
- entity type/id
- timestamp
- before/after or relevant metadata

Audit integrity:

- An audit event is written in the same transaction as the change it describes, so a change cannot be committed without its audit event (T-022).
- The application has no update or delete path for audit events.
- Where the database provider allows, the runtime database role has no `UPDATE` or `DELETE` privilege on the audit table.

## Web protections

- Content Security Policy with a per-request nonce, plus `nosniff`, clickjacking protection, Referrer-Policy, Permissions-Policy, and HSTS in production (T-032).
- Cross-site request forgery: state-changing API requests must come from the app's own origin with a JSON body (T-033). Server Actions and Better Auth check the origin themselves.
- Free-text input rejects control characters (T-034).

## Security logging

Sign-ins (success and failure), permission denials, unauthenticated API calls, and rejected cross-origin requests are logged as JSON security events. Passwords, cookies, tokens, and hashes are never logged. See `24_SECURITY_TESTING.md` for the event list.

## Dependencies

CI fails on any high or critical advisory that has not been triaged (T-035). Dependabot proposes updates weekly.

## Security testing

See `24_SECURITY_TESTING.md`: automated tests for each OWASP Top 10:2025 category, plus the planned scan and manual pentest.

## Sensitive data

Avoid collecting unnecessary personal data. V1 does not require health or biometric data.
