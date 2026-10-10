# 14 — MVP Acceptance Criteria

## Customer

- [ ] Staff can create a customer.
- [ ] Customer receives a unique customer code.
- [ ] Duplicate customer code is rejected.
- [ ] Staff can search by code/name/phone.
- [ ] Customer detail shows all contracts.

## Contract

- [ ] Staff can create a session-based contract for a customer.
- [ ] Contract shows total/completed/remaining sessions.
- [ ] Contract shows value/paid/debt.
- [ ] Debt is calculated from confirmed payments.
- [ ] An active contract past its end date shows as expired, without any scheduled job.

## Booking

- [ ] Staff can create a PT booking.
- [ ] Same trainer cannot have overlapping active bookings, including when two bookings are created at the same time.
- [ ] Booking creation does not consume a session.
- [ ] Staff can reschedule and cancel eligible bookings.

## Session

- [ ] Staff/PT can manually check in an eligible booking.
- [ ] Check-in does not consume a session.
- [ ] Completion consumes exactly one session.
- [ ] Repeated completion does not consume again, including concurrent completion requests.
- [ ] No-show does not consume a session in V1.
- [ ] Completion fails when no sessions remain, including when the last sessions are completed at the same time.

## Finance

- [ ] Authorized user can record a confirmed contract payment.
- [ ] Contract debt updates correctly.
- [ ] Submitting the same payment twice (double-click or retry) records one payment.
- [ ] Voiding a payment requires a reason and removes it from the paid amount.
- [ ] Authorized user can record income/expense transactions.

## Dashboard / reports

- [ ] Dashboard shows today's booking/session status totals.
- [ ] Dashboard shows financial summary.
- [ ] Session, PT, contract/debt, and finance reports are available.

## Security

- [ ] Users must authenticate.
- [ ] RBAC is enforced server-side.
- [ ] A disabled user loses access on their next request.
- [ ] Critical actions produce audit events.

## Production readiness

- [ ] Production database backup is enabled.
- [ ] Restore procedure is documented.
- [ ] Critical E2E suite passes.
