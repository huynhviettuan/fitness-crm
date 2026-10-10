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
| **A01 Broken Access Control** | Authorization in services (`assertCan`, T-020/T-024); trainer data scope (OQ-006 interim); fields such as `customerCode` and `status` cannot be set by the client | `e2e/security/access-control.spec.ts`: every `/api/v1` route × method without a session → 401, found automatically from the source tree; role matrix; trainer cannot open a customer by its real id; mass assignment ignored; unused Better Auth endpoints → 404. `src/lib/security/server-actions.test.ts`: every Server Action calls `requireActionUser()`. `tests/integration/*`: service-level role tests |
| **A02 Security Misconfiguration** | Content Security Policy with a per-request nonce (`src/proxy.ts`); `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, HSTS in production (`next.config.ts`); no `X-Powered-By`; environment validated at startup | `e2e/security/headers.spec.ts`: headers present on pages and API; CSP is strict and its nonce changes per request; the main screens and login run with no CSP violations |
| **A03 Software Supply Chain Failures** | `npm ci` from the lockfile; `npm run security:audit` gate; triaged allowlist; Dependabot; CLI tools kept out of runtime dependencies; `mysql2` forced to a patched version | `scripts/audit-check.mjs` in CI: fails on any untriaged high/critical advisory or an expired allowlist entry |
| **A04 Cryptographic Failures** | Better Auth password hashing; secret of at least 32 characters; HttpOnly SameSite=Lax session cookie, Secure over HTTPS; TLS from the platform | `access-control.spec.ts`: API responses never contain password, hash, token, or secret fields. `auth-hardening.spec.ts`: cookie flags |
| **A05 Injection** | Prisma parameterized queries (raw SQL only as tagged templates); React output escaping; CSP blocks injected scripts; control characters rejected | `e2e/security/injection.spec.ts`: SQL, script, and template payloads stored verbatim and rendered without running; SQL in search matches nothing |
| **A06 Insecure Design** | Concurrency and idempotency design (T-013 to T-015, T-036); fail-closed interim rules for open questions | Abuse-case tests per phase: concurrent code generation and duplicate emails; INT-001 to INT-003 and INT-007 (Phase 3) and INT-004 and INT-005 (Phase 4), also over HTTP; concurrent overpayment |
| **A07 Authentication Failures** | Generic sign-in error; rate limit of 20 per minute per IP; 12-hour session expiry; sessions revoked on disable and on password reset; no self sign-up | `e2e/security/auth-hardening.spec.ts`: sign-out ends the session on the server; forged cookies rejected. `e2e/security/rate-limit.spec.ts`: repeated failures get 429. `users.int.test.ts`: INT-006 |
| **A08 Software or Data Integrity Failures** | `/api/v1` state changes require the app's own `Origin` and a JSON body; Server Actions and Better Auth check origin themselves; audit events written in the same transaction (T-022) | `e2e/security/csrf.spec.ts`: other-origin and missing-Origin requests → 403 and nothing changes; `text/plain` → 415; no permissive CORS |
| **A09 Security Logging & Alerting Failures** | JSON security events (below); domain audit log | `tests/integration/security.int.test.ts`: denials and sign-ins are logged; passwords never appear in logs |
| **A10 Mishandling of Exceptional Conditions** | Errors leave in the documented shape (`handleApi`, `runAction`); unexpected errors become `INTERNAL_ERROR` with details only in the server log; input fails closed | `e2e/security/errors.spec.ts`: malformed JSON, wrong types, non-object bodies, oversized fields, control characters, bad ids, unsupported methods, absurd paging — all documented errors without stack traces |

Phase 2 added `e2e/security/contracts.spec.ts`: contract role matrix, mass assignment of status/code/opening balances, Idempotency-Key required and not reusable, and input errors.

Phase 4 added `e2e/security/finance.spec.ts`: payment, void, and cash role matrix (a trainer cannot void, E2E-009); mass assignment of status, contract, and recorder; INT-004 and INT-005 over HTTP, including five identical submissions at once; input errors, future dates, overpayment, and payments on a cancelled contract.

Phase 3 added `e2e/security/bookings.spec.ts`: trainer, booking, and completion role matrix; a trainer kept to their own bookings even with a real id (A-007); mass assignment of status, times, session facts, customer, and contract; a trainer's login link refused for a non-trainer account; INT-001 and INT-003 over HTTP; input errors and the documented business-rule codes.

## Findings fixed when layer 1 was introduced

The security tests were written first and run against the app as it was. They failed in these places, and each fix turned the test green.

| OWASP | Finding | Fix |
|---|---|---|
| A08 | `/api/v1` accepted POST/PATCH from another origin, or with no Origin at all, relying only on SameSite cookies | Origin check in `handleApi`; JSON-only bodies (`UNSUPPORTED_MEDIA_TYPE`) |
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

Alerting is not set up yet. Before go-live, forward these logs (e.g. a Vercel log drain) and alert on bursts of `auth.sign_in.failed` and `request.cross_origin_rejected`.

## Dependency triage (A03)

`npm run security:audit` runs in CI. When it fails:

1. Upgrade the dependency if a fixed version exists. Use an `overrides` entry in `package.json` for a transitive dependency when the fix is in the same major version.
2. Otherwise, add the advisory to `security/audit-allowlist.json` with why it is not exploitable here and a `reviewBy` date at most three months away.
3. The gate fails again when the review date passes, and warns when an entry is no longer needed.

## Running

```text
npm run security:audit    # dependency gate
npm test                  # includes the Server Action guard
npm run test:integration  # includes security.int.test.ts
npm run test:security     # builds, then runs e2e/security (rate-limit project last)
```

The E2E suite runs against a production build, so the CSP has no `'unsafe-eval'` and production code paths are tested.

## Deployment requirements

- **Client IP:** Better Auth trusts `X-Forwarded-For` only when it holds a single address. Vercel sets it to the real client IP. Behind any other proxy, configure `advanced.ipAddress` in `src/lib/auth/auth.ts`, or rate limiting falls back to one shared bucket.
- **Origin:** `BETTER_AUTH_URL` must be the exact public origin of each deployment. The API Origin check and Better Auth both use it, so preview deployments need their own value.
- **HSTS** is sent only in production builds.

## Open items

- Layer 2 (ZAP) and layer 3 (manual ASVS pentest), per the table at the top.
- Secret scanning in CI, and pinning CI actions to commit SHAs, once the repository is on GitHub.
- Decisions TS-004 (MFA for admins) and TS-005 (per-account lockout) in `18_DECISIONS_ASSUMPTIONS.md`.
- Security alerting (see A09 above).
