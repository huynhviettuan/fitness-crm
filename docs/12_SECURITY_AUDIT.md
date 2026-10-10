# 12 — Security & Audit

## Authentication

- Passwords hashed (Better Auth); no plaintext passwords or tokens in logs.
- Sessions in the database; 12-hour idle expiry; httpOnly, Secure, SameSite cookies (T-044).
- Sign-in allowed only within each account's permitted days and hours; outside them every request is refused (D-017).
- Login history: time, device, IP, success (D-017).
- Disabled accounts lose access on their next request (T-017).
- Rate limit on sign-in per IP; admin two-factor recommended before go-live (TS-004).
- Generic error message on failed sign-in.

## Authorization

- Every API endpoint declares a permission key; guards check it with branch access, data scope, and login hours (T-046).
- Hidden menus and buttons are UX only.
- Field masking removes hidden fields (member phone, email, address, documents; receipt totals) from responses and exports (D-017).
- Sensitive actions are separate permissions (D-017).
- Approval matrix: pending records have no effect; nobody approves their own submission (D-018).

## Data validation

- Zod validation at the API boundary for every field; free text rejects control characters (T-034).
- Drop-down values must be active options of the right list; "Khác" requires a note (D-016).
- Money whole VND and greater than zero where required; dates and time ranges valid; status transitions allowed; references within the user's branches.

## Money and session safety

- Paid and debt derived only from valid receipts; sessions left derived only from sessions and change vouchers (D-034, T-050).
- Locked transactions and idempotency keys protect concurrent and repeated requests (T-013, T-015, T-040).
- Approved contracts are locked; corrections go through change vouchers or delete-and-recreate (D-022).
- Receipt date edits are a separate permission and logged (D-034).

## Audit log (T-048)

- Every create, update, delete, approval, rejection, and every change of roles, permissions, data scopes, masks, thresholds, approval matrix, option lists, parameters, and status rules writes: actor, time, entity, action, before and after values.
- It is written in the same transaction as the change (T-022).
- The application has no update or delete path for audit events, and the runtime database role has no `UPDATE` or `DELETE` grant on the audit table.
- Authorized users search it by user, entity, action, and date.

## Trash (D-035)

- Deleted business records keep their data, leave every list, report, and revenue figure, and become read-only.
- Each deletion stores who, when, and a mandatory reason; the trash is permanent and nobody can purge it; only admin views it by default.
- Codes and voucher numbers of deleted records are never reused.

## Personal data (D-042)

- ID document numbers and basic health data are encrypted at the application level (AES-256-GCM); keys come from the environment or a key manager and are rotated by procedure (T-052).
- Scans and transfer proofs are stored in private storage behind short-lived signed URLs.
- Viewing these fields is a permission and is masked otherwise, including in exports.
- Customer consent is recorded with date and version of the notice.
- Customer chats are sent to an external AI service only with the owner's consent and after removing identifying data (OQ-025).
- The owner confirms legal requirements, including cross-border storage in the Singapore region, with counsel.

## Web protections

- Content Security Policy with a per-request nonce, `nosniff`, clickjacking protection, Referrer-Policy, Permissions-Policy, HSTS (T-032).
- State-changing API requests need the app's own Origin and a JSON body (T-033); CORS allows only the web app's origin.

## Security logging

Sign-ins, failed sign-ins, sign-ins outside allowed hours, permission denials, unauthenticated calls, rejected cross-origin requests, and exports of masked data are logged as JSON security events. Passwords, cookies, tokens, hashes, ID numbers, and health data are never logged. Alerts on bursts are set up before go-live (`24_SECURITY_TESTING.md`).

## Dependencies

CI fails on any untriaged high or critical advisory (T-035); Dependabot proposes updates weekly.
