# 24 — Security Testing

Security testing follows the [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/). It has three layers:

| Layer | What | When | Status |
|---|---|---|---|
| 1. Automated security tests | Unit, integration, and E2E tests mapped to each OWASP category, plus a dependency gate | Every change, in CI | **Built** (2026-10-09) |
| 2. Dynamic scan (DAST) | OWASP ZAP baseline scan plus an authenticated active scan against a production build | Every release | Planned |
| 3. Manual pentest | OWASP ASVS checklist, focused on business-logic abuse that scanners cannot find | Before go-live, and after Phases 3 and 4 (sessions and money) | Planned |

Scanning our own app locally needs no permission. Before scanning a deployed environment, check the hosting provider's penetration-testing policy.

## OWASP Top 10:2025 coverage

| Category | Controls in the app | Automated tests |
|---|---|---|
| **A01 Broken Access Control** | Authorization in services (`assertCan`, T-020/T-024); trainer data scope (OQ-006 interim); fields such as `customerCode` and `status` cannot be set by the client | `e2e/security/access-control.spec.ts`: every `/api/v1` operation without a session → 401, found automatically from `apps/api/openapi.json`; role matrix; trainer cannot open a customer by its real id; mass assignment ignored; unused Better Auth endpoints → 404. `apps/web/src/lib/security/api-boundary.test.ts`: no web file imports Prisma or server-side auth, and Server Actions call nothing but the API (T-043). `apps/api/test/integration/*`: service-level role tests |
| **A02 Security Misconfiguration** | Content Security Policy with a per-request nonce (`apps/web/src/proxy.ts`); `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, HSTS in production, from the web app (`next.config.ts`) and from the API for direct clients (`platform/http/security-headers.ts`, plus `Cache-Control: no-store`); no `X-Powered-By`; environment validated at startup in both apps; API docs (`/api/docs`) not served in production | `e2e/security/headers.spec.ts`: headers present on pages and API; CSP is strict and its nonce changes per request; the main screens and login run with no CSP violations |
| **A03 Software Supply Chain Failures** | `pnpm install --frozen-lockfile`; pnpm's release-age policy (no version younger than a day) and build-script allowlist (`allowBuilds` in `pnpm-workspace.yaml`); `pnpm security:audit` gate; triaged allowlist; Dependabot; CLI tools kept out of runtime dependencies; `mysql2` forced to a patched version | `scripts/audit-check.mjs` in CI: fails on any untriaged high/critical advisory or an expired allowlist entry |
| **A04 Cryptographic Failures** | Better Auth password hashing; responses encoded with their schema, so unlisted fields never leave the API (T-043); secret of at least 32 characters; HttpOnly SameSite=Lax session cookie, Secure over HTTPS; TLS from the platform | `access-control.spec.ts`: API responses never contain password, hash, token, or secret fields. `auth-hardening.spec.ts`: cookie flags |
| **A05 Injection** | Prisma parameterized queries (raw SQL only as tagged templates); React output escaping; CSP blocks injected scripts; control characters rejected | `e2e/security/injection.spec.ts`: SQL, script, and template payloads stored verbatim and rendered without running; SQL in search matches nothing |
| **A06 Insecure Design** | Concurrency and idempotency design (T-013 to T-015, T-036); fail-closed interim rules for open questions | Abuse-case tests per phase: concurrent code generation and duplicate emails; INT-001 to INT-003 and INT-007 (Phase 3) and INT-004 and INT-005 (Phase 4), also over HTTP; concurrent overpayment |
| **A07 Authentication Failures** | Generic sign-in error; rate limit of 20 per minute per IP; 12-hour session expiry; sessions revoked on disable and on password reset; no self sign-up | `e2e/security/auth-hardening.spec.ts`: sign-out ends the session on the server; forged cookies rejected. `e2e/security/rate-limit.spec.ts`: repeated failures get 429. `users.int.test.ts`: INT-006 |
| **A08 Software or Data Integrity Failures** | `/api/v1` state changes require the app's own `Origin` and a JSON body (`platform/http/request-guards.middleware.ts`); Server Actions and Better Auth check origin themselves; audit events written in the same transaction (T-022) | `e2e/security/csrf.spec.ts`: other-origin and missing-Origin requests → 403 and nothing changes; `text/plain` → 415; no permissive CORS |
| **A09 Security Logging & Alerting Failures** | JSON security events (below); domain audit log | `apps/api/test/integration/security.int.test.ts`: denials and sign-ins are logged; passwords never appear in logs |
| **A10 Mishandling of Exceptional Conditions** | Errors leave in the documented shape (the API's `ErrorFilter`, including 405 for an unsupported method and body-parser errors; `runAction` in the web); unexpected errors become `INTERNAL_ERROR` with details only in the server log; input fails closed | `e2e/security/errors.spec.ts`: malformed JSON, wrong types, non-object bodies, oversized fields, control characters, bad ids, unsupported methods, absurd paging — all documented errors without stack traces |

**Brief v2 (milestones M1–M11):** the suite moves to the NestJS API. Every endpoint declares a permission key; an automated test walks the OpenAPI document and checks that every endpoint refuses anonymous calls, refuses a role without the permission, applies data scope (another consultant's lead is `404`) and branch access, and returns no masked field. New abuse cases: self-approval, using a pending record, editing an approved contract, deleting without a reason or out of order, double payouts, concurrent reactivation, sign-in outside allowed hours, masked fields in Excel exports, and access to ID and health data (`13_TEST_STRATEGY.md`). Manual pentest (layer 3) before go-live and after M4 and M5 (money and sessions).

M1 slice 1 (2026-10-10) moved the suite onto the NestJS API without changing what it checks: browsers still call `/api/v1` on the web origin, which forwards to the API (T-053). The access-control inventory now comes from the OpenAPI document, so it also covers the new read endpoints. The entries below describe the Phases 0–4 code.

M1 slice 2 (2026-10-10) replaced the fixed roles with the permission tree (T-054). `e2e/security/permissions.spec.ts` signs in as a role with no permissions and walks every operation in the OpenAPI document (`403` everywhere except `/me`), checks that a Fitness Manager cannot reach users, roles, or branches, and that another branch's customer is `404`. `apps/api/test/integration/permissions.int.test.ts` covers overrides, data scope (*only mine*), hidden fields, branch access, allowed hours (refused at sign-in and on the next request), the login history, and self-protection. `apps/api/src/openapi.test.ts` fails when an endpoint declares no permission. The role matrices in the contract, booking, and finance specs now follow doc 09.

M1 slice 3 (2026-10-10) added option lists and system parameters (T-055). The permission walk now reads each operation's `x-permission`: endpoints for any signed-in user (own profile, option lists, parameters) must answer, every other one must refuse a role without permissions. A Fitness Manager reads option lists but cannot change them or the parameters. `e2e/security/finance.spec.ts` checks that a method from another list, an unknown option, and "Khác" without a note are field errors, and `configuration.int.test.ts` covers inactive options, the one-"Khác" constraints, and the audit of every change.

M1 slice 4 (2026-10-10) replaced voids with deletion to the trash (T-056). `e2e/security/finance.spec.ts` checks the delete permission per role (only Admin and "Kế toán"), that a deletion needs a reason and "Khác" a note, and that a deleted record is `404`; a client cannot set deletion fields on create. The trash and the action history are refused to a Fitness Manager (`permissions.spec.ts`); `history.int.test.ts` covers branch limits, masked amounts and fields, and five concurrent deletions leaving one trash entry.

M1 slice 5 (2026-10-11) added maker-checker approvals (T-057). `approvals.int.test.ts` covers: no effect while pending, no self-approval (also a database CHECK), approvers by current rule and branch, one decision under concurrent approvals, rejection reasons, pending receipts in the value cap, held deletions and identity edits, and matrix changes taking effect at once. Over HTTP, `security/finance.spec.ts` checks that a client cannot set `approvalStatus` (mass assignment) and that a second deletion request is `409`; the matrix endpoints are refused to a Fitness Manager.

M1 slice 6 (2026-10-11) added employees and working schedules (T-058). `employees.int.test.ts` covers roles, branch access, the PT's own-only staff scope, option and login checks (one employee per login, also under concurrent requests), shifts that overlap, days off, and the calendar's trainers; `bookings.int.test.ts` covers bookings outside working hours and on days off. Over HTTP, `security/employees.spec.ts` checks who may add employees, that a PT reads only their own profile and schedule and changes neither, that the code, search name, and id cannot be set by the client (mass assignment), that a linked login cannot be linked again, and the input errors.

M1 slice 7 (2026-10-11) added tasks and notifications (T-060). `tasks.int.test.ts` covers who may give, see, move, edit, and cancel tasks (scope *only mine* vs *all*, other branches, department members), one accept under concurrent requests, valid assignees, departments, linked records and mentions, and the reminders; `notifications.int.test.ts` covers that users read and mark only their own, approval notifications, and the job runner. Over HTTP, `security/tasks.spec.ts` checks that a task between others is not found and cannot be moved or commented, that an assignee cannot cancel or edit, that status, assigner, and timestamps cannot be set by the client (mass assignment), that another user's notification is not found, and the input errors.

M2 slice 1 (2026-10-11) added leads (T-061). `leads.int.test.ts` covers who may add leads, the consultant's own-only scope, option lists, hidden phone and email (not shown, not searchable, not overwritten), leads kept off the customer screens and contracts, and one person per phone, also when two arrive at once. Over HTTP, `security/leads.spec.ts` checks the roles, that a consultant cannot open another person's lead, that a lead is not reachable as a customer, that the code, stage, status, person in charge, and customer code cannot be set by the client (mass assignment), that a duplicate phone names the existing record only to someone who may see it, and the input errors.

Phase 2 added `e2e/security/contracts.spec.ts`: contract role matrix, mass assignment of status/code/opening balances, Idempotency-Key required and not reusable, and input errors.

Phase 4 added `e2e/security/finance.spec.ts`: payment, void, and cash role matrix (a trainer cannot void, E2E-009); mass assignment of status, contract, and recorder; INT-004 and INT-005 over HTTP, including five identical submissions at once; input errors, future dates, overpayment, and payments on a cancelled contract.

Phase 3 added `e2e/security/bookings.spec.ts`: trainer, booking, and completion role matrix; a trainer kept to their own bookings even with a real id (A-007); mass assignment of status, times, session facts, customer, and contract; a trainer's login link refused for a non-trainer account; INT-001 and INT-003 over HTTP; input errors and the documented business-rule codes.

## Findings fixed when layer 1 was introduced

The security tests were written first and run against the app as it was. They failed in these places, and each fix turned the test green.

| OWASP | Finding | Fix |
|---|---|---|
| A08 | `/api/v1` accepted POST/PATCH from another origin, or with no Origin at all, relying only on SameSite cookies | Origin check (then `handleApi`, now API middleware); JSON-only bodies (`UNSUPPORTED_MEDIA_TYPE`) |
| A02 | No CSP, no clickjacking protection, no `nosniff`, `X-Powered-By: Next.js` sent | Headers in `next.config.ts`; nonce-based CSP in `src/proxy.ts` |
| A10/A05 | A NUL character in a name caused a 500: PostgreSQL rejects it | Control characters rejected by validation (`invalidCharacters`) |
| A07 | Rate limiting was off outside production and could not be tested | Enabled in every environment except unit/integration tests |
| A03 | 13 high advisories; the shadcn CLI was a runtime dependency | shadcn moved to dev dependencies; `mysql2` override; 2 triaged advisories with no available fix (see `security/audit-allowlist.json`) |
| A09 | Sign-ins and permission denials were not logged | Security event log |

## Security events (A09)

One JSON line per event on the server log, with `type: "security"`. Passwords, cookies, tokens, and hashes are never logged.

| Event | Level | Fields |
|---|---|---|
| `auth.sign_in.succeeded` | info | `userId`, `ip` |
| `auth.sign_in.failed` | warn | `email`, `ip`, `status` (wrong password, unknown user, or disabled account) |
| `auth.unauthenticated` | info | `method`, `path`, `ip` |
| `authz.denied` | warn | `userId`, `role`, `permission` |
| `request.cross_origin_rejected` | warn | `method`, `path`, `origin`, `ip` |

Alerting is not set up yet. Before go-live, forward the API's logs (the platform's log drain) and alert on bursts of `auth.sign_in.failed` and `request.cross_origin_rejected`.

## Dependency triage (A03)

`pnpm security:audit` runs in CI. When it fails:

1. Upgrade the dependency if a fixed version exists. Use an `overrides` entry in `pnpm-workspace.yaml` for a transitive dependency when the fix is in the same major version.
2. Otherwise, add the advisory to `security/audit-allowlist.json` with why it is not exploitable here and a `reviewBy` date at most three months away.
3. The gate fails again when the review date passes, and warns when an entry is no longer needed.

## Running

```text
pnpm security:audit       # dependency gate
pnpm test                 # includes the web's API-boundary guard
pnpm test:integration     # includes security.int.test.ts
pnpm test:security        # builds both apps, then runs e2e/security (rate-limit project last)
```

The E2E suite runs against production builds of both apps, so the CSP has no `'unsafe-eval'` and production code paths are tested.

## Deployment requirements

- **Client IP:** sign-in rate limits and logs key on `X-Forwarded-For`. The web app forwards the address it received (Vercel sets it to the real client IP and overwrites what the client sent); the API uses the connection address when the header is missing (`platform/http/client-address.ts`). The API trusts the header, so in production it should be reachable only from the web app and through the platform's proxy; revisit (`advanced.ipAddress.trustedProxies` in `apps/api/src/platform/auth/auth.ts`) before direct clients arrive.
- **Origin:** `BETTER_AUTH_URL` must be the exact public origin of each deployment. It is the web app's URL, set in the API: the API's Origin check and Better Auth both use it, so preview deployments need their own value.
- **HSTS** is sent only in production builds.

## Open items

- Layer 2 (ZAP) and layer 3 (manual ASVS pentest), per the table at the top.
- Secret scanning in CI, and pinning CI actions to commit SHAs, once the repository is on GitHub.
- Decisions TS-004 (MFA for admins) and TS-005 (per-account lockout) in `18_DECISIONS_ASSUMPTIONS.md`.
- Security alerting (see A09 above).
