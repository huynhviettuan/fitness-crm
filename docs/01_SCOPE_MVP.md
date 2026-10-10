# 01 — MVP Scope

## In scope

### Customer Management
- Create/update/search customer.
- Unique customer code/ID.
- Customer detail page.
- View all contracts, payments, bookings, and sessions of a customer.

### Contract Management
- Create contract for a customer.
- Store package name, contract value, start/end date, total sessions, and status.
- View session consumption.
- View payments and outstanding debt.

### Booking & Session Operations
- Calendar/list booking view.
- Create, reschedule, cancel booking.
- Assign customer, contract, PT, scheduled start/end.
- Manual check-in.
- Mark session completed.
- Track no-show.
- Consume exactly one contract session on completion.

### Finance
- Record confirmed payments for contracts.
- Show amount paid and debt.
- Record manual income/expense transactions.
- View payment history.

### Dashboard & Reports
- Today's bookings and session statuses.
- Completed session counts.
- PT performance.
- Contract revenue, collected amount, debt, expense, and net cash flow.
- Export can be added after core reporting is stable.

### Administration
- Login.
- Role-based permissions.
- User management.
- Audit log for critical actions.

## Explicitly out of scope for V1

- Fingerprint devices or biometric integration.
- Multi-gym SaaS / multi-tenant isolation.
- Mobile application.
- Facebook/TikTok/WhatsApp unified inbox.
- Online payment gateway automation.
- Pro Shop / inventory.
- Locker/towel management.
- Loyalty points.
- Payroll.
- Advanced marketing automation.
- Automatic no-show session deduction.

## Future-compatible design

The architecture should allow later addition of:

- Fingerprint connector.
- WhatsApp/Facebook/TikTok messaging.
- Mobile app.
- Multiple branches.
- Online payment gateways.
