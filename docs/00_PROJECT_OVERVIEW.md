# 00 — Project Overview

## Product

**Flow Fitness CRM** is Flow Fitness's own system to replace GymMaster (D-013). It covers the customer journey from lead to contract, sessions, the cash book, and reports, for several branches (D-014). It is the first part of a larger ERP, so modules and data are designed to be extended (brief §1).

## Why build it

- Own the customer data.
- Control long-term cost and avoid dependence on a vendor's policies.
- Add what GymMaster lacks: consulting management with timed steps and audit, and workout plans whose results are tracked in each customer's profile.

## Users

| Role (initial) | Main work |
|---|---|
| Admin | Configuration, check-in ("Đã tập"), deletions, trash, every report |
| Fitness Manager | New leads and escalations, lead reassignment, consulting audit, contract and exception-price approval |
| Master (head coach) | Reviews every PT's workout plans, handles escalations, workout dashboard |
| Consulting | Works assigned leads through the consulting journey, creates contracts for approval |
| PT | Books sessions, writes workout plans, logs sessions, sees own session report |
| Receptionist | Walk-in leads, Show / No show, booking support, completes customer details |
| Marketing | Lead reports by channel and source, without phone numbers or ID documents |

Roles and their permissions are configured by admin (D-017, `09_RBAC.md`).

## Core principles

- **One record per person**, from lead to customer (D-019).
- **Fixed flows, configurable values** (D-015), entered through drop-downs (D-016).
- **Approval by a superior** for configured actions; approved contracts are locked (D-018, D-022).
- **Everything derived:** sessions left from sessions and change vouchers; paid and debt from valid receipts (T-050, D-034).
- **Nothing is hard-deleted:** deletions go to a permanent trash with a reason (D-035).
- **Every change is audited** with before/after values (T-048).
- Customers are notified by **email** whenever their session count changes (D-036).

## Documents

The brief is `docs/source/BRIEF_V2_vi.md`. Start with `README.md` for the documentation map.
