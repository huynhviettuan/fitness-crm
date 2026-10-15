# 32. Customer input of 2026-10-15: review

On 2026-10-15 Flow Fitness sent a framework document (*Khung sườn định hướng phần mềm quản lý*, transcribed in
`docs/source/FRAMEWORK_2026-10-15_vi.md`) and six Excel exports of GymMaster. This document compares them with what is built
(M1 to M10) and records what they change. The exports hold members' personal data: they are **not** in the repository and are not
quoted here; only their structure is.

## 1. The framework document

It is a direction, not a specification: seven layers, the customer journey, ten modules, principles, the dashboards wanted and a
three-phase plan. Its principles are the ones the system was built on (one customer one record, D-019; enter once use everywhere;
statuses, owners and deadlines; audit with before/after and reason, T-048; configurable lists, D-015; role-based access, T-046;
multi-branch, D-014; the data exportable and handed over).

| Layer / module | State | Where |
|---|---|---|
| CRM & Customer 360 (one code, no duplicates, history) | Built | M2 leads and merge (D-019), M3 customers, M10 conversation |
| Lead & Sales Pipeline (stages, assignment, SLA, follow-up, Lost reasons, history) | Built | M2 (round robin, checklist with deadlines, re-care, refusal reasons, audit) |
| Marketing Tracking: sources, Leads, Assessments, buyers, revenue by source | Built | lead reports (M2/M3), AC-06 |
| Marketing Tracking: **campaign costs, CPL, CAC, ROAS** | **Not built** | no campaign or cost record exists |
| Assessment: booking, came / did not come | Built | studio appointment, Show / No-show (M2) |
| Assessment: **results by metric and unit, customer report, comparison of assessments** | **Not built** | only the assessment type is recorded |
| PT & Membership (packages, contracts, Coach schedule, session states, used / left, renewal) | Built | M4, M5, M6, M8 |
| Customer Service: near the end of sessions or validity | Built | contract notices (M6.3) |
| Customer Service: **training less often (at risk), complaints and their handling** | **Not built** | |
| Finance (receipts, debt, discounts, refunds, reconciliation, export) | Built | cash book (M4/M6), cancellations with refund (M8.4), exports |
| Finance: **revenue recognised by policy** | Partly | PT allocation per session (D-032); no recognised-revenue report |
| Dashboard: Sales KPIs (first response, booking, show-up, conversion, deal size) | Built | lead report (A-090), overview |
| Dashboard: **Customer KPIs (retention, renewal, churn), targets vs actual (GAP), drill-down everywhere** | Partly | renewals are counted; no targets, churn or retention definitions |
| Automation & Integration (reminders, overdue alerts, re-care, channels) | Built | jobs (T-059), M10 channels |
| Integration: **Power BI / API for analysis** | Not built | Excel exports only |
| Security & Admin (roles, audit, lists, handover) | Built | M1; backup and restore are the host's (doc 15) |

Their **phase plan** (Phase 1 CRM and pipeline; Phase 2 Assessment, PT, schedule, payments; Phase 3 automation, channels,
retention, BI) is mostly delivered already, except the items marked above. Nothing in the document contradicts a confirmed
decision.

## 2. The GymMaster exports

| File | Rows | What it is |
|---|---|---|
| Thông tin hội viên | 1 | Members, 39 columns |
| Danh sách hợp đồng | 5 | Contracts, 56 columns (paid, debt, sessions used and left, PT and Sale with their share, approval) |
| Báo cáo thu chi | 7 | Cash book: receipts with method, opening balance and running balance |
| Báo cáo booking | 155 | Sessions: member, date, time in and out, status *Attended* / *Open* / *Cancelled*, coach |
| PT Training Report | 40 | GymMaster's `employee_pt_training` |
| Check in Report | 0 | Headers only |

**PT pay confirmed.** The PT report computes exactly D-032: allocation per session = contract value ÷ sessions; PT allocation =
sessions taught ("Show dạy") × allocation per session × commission rate (100%) × timesheet rate (100%). Our report has every one of its
amounts; it lacks only *Tổng show* (all sessions of the PT in the period) and *Trail ra HĐ* (empty in the export).

**The import (M9.2) needs changes before cut-over.** It was written before any export existed (OQ-053, OQ-069) and expects one workbook
with tabs *customers / contracts / staff*. The real exports are **one file per report**, each with a single sheet *Worksheet*, and most of
their headers are not among the aliases:

| Field | GymMaster header | Matched today |
|---|---|---|
| Member code | Mã HV | no |
| Member name | Họ tên hội viên | no |
| Contract code | Mã HĐ | no |
| Package | Dịch vụ - gói thẻ | no |
| Contract date | Ngày HĐ | no |
| Start / end | Ngày bắt đầu tập / Ngày hết hạn tập | no |
| Sessions | Số buổi thẻ gạch (+ Số buổi KM) | no |
| Sessions used / left | Số buổi đã tập / Số buổi còn lại | no / not read |
| Value | Tổng thanh toán (after discount; *Tổng tiền* is before) | *Tổng tiền* only |
| Paid / debt | Đã thanh toán / Còn nợ | yes / not read |
| Type | Loại HĐ (New / Renew) | not read |
| Approved | Duyệt HĐ? (Đã duyệt / Chưa duyệt) | not read |
| PT and Sale | Nhân viên PT / Nhân viên Sale, as "Name (100%)" | not read |

Data shapes to handle: dates as text `dd/MM/yyyy` (and `dd/MM/yyyy HH:mm:ss`); an empty birth date written `30/11/-0001`; phones of 10,
11 or 14 digits; names with notes in brackets; a package priced per session (*buổi lẻ*) whose session count is not in its name; contracts
not yet approved in GymMaster; a cash book whose opening balance is in the billions (cash book opening balance, not member debt).

## 3. What it changes

- **M9.2b, import the real exports** (proposed next): read the separate files as they come, the aliases and shapes above, sessions
  including bonus, value after discount, PT and Sale with their shares, contract type, and decide what an unapproved GymMaster contract
  becomes (OQ-078). The sample is small (5 contracts): the full export is needed to rehearse the cut-over (doc 29).
- **New candidate slices** (each needs the owner's definitions first, OQ-079): campaign costs with CPL / CAC / ROAS; Assessment results
  with metrics, units, a customer report and comparison (health data, encrypted, D-042); at-risk customers and complaints;
  retention / renewal / churn with agreed formulas; targets and the gap to them; a read-only data API or Power BI feed.
- PT report: add *Tổng show* (small).
