# 19 — Future Roadmap

These features are intentionally excluded from V1. The V1 full-stack Next.js architecture should remain modular enough to evolve without introducing infrastructure prematurely.

## V1.1 — Operational improvements

- contract freeze/extension
- advanced trainer working hours
- report export to Excel
- richer dashboard filtering
- notifications/reminders

## V1.5 — Lead CRM

```text
Lead -> Follow-up -> Customer -> Contract
```

Potential lead sources:

- walk-in
- referral
- Facebook
- TikTok
- WhatsApp

This can initially remain inside the same Next.js application.

## V2 — Unified Messaging Inbox

Potential integrations:

- WhatsApp Business Platform
- Facebook Messenger
- TikTok Business Messaging

Flow:

```text
Channel -> Webhook/API -> Inbox -> Lead/Customer -> Follow-up -> Contract
```

Start with Vercel Route Handlers if webhook/runtime characteristics fit the platform. If integrations require durable queue workers, long processing, or high webhook volume, introduce a separate worker/service only at that time.

## V2 — Fingerprint integration

When hardware exists:

```text
Fingerprint Device -> Local Connector -> CRM API -> Booking -> CHECKED_IN
```

A local connector may require a separately deployed process because Vercel cannot directly access a gym LAN device.

Fingerprint should automate check-in only. Core session-consumption rules remain unchanged.

## V2/V3 — Mobile

Member app possibilities:

- contract/session balance
- bookings
- reminders
- QR identity/check-in

Trainer app possibilities:

- own calendar
- customer/session context
- session completion

The mobile client should consume the same domain behavior/API contracts rather than duplicate business rules.

## Future backend extraction criteria

A dedicated API/worker platform such as Railway, Render, or another container/runtime should be considered only when one or more of these become real requirements:

- local hardware/device connector
- durable queue workers
- long-running background jobs
- heavy asynchronous file/report generation
- high-volume webhook/message processing
- runtime requirements incompatible with Vercel
- need for independent API scaling/deployment

If extracted later, keep Next.js for the web UI and move application services behind a dedicated API incrementally. Do not rewrite the full system only for architectural purity.

## Later — Multi-branch

Only introduce branches/tenancy if the gym business actually expands. Do not add SaaS complexity prematurely.
