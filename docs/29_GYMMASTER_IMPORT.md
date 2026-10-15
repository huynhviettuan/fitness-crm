# 29. GymMaster import (runbook)

Brief §11, D-039, D-011, FR-IMP-001, AC-22. Built in M9.2; reconciliation and the cut-over come with M9.3.

The import is a command for the developer, not a screen. It reads one Excel workbook, or GymMaster's own exports as they come
(M9.2b), checks every row, and **writes nothing
unless `--commit` is given**. Run it on staging until the owner has confirmed the cleanup list; production only after OQ-014.

## 1. The workbook

One tab for each kind of record. A tab is found by its name (`customers`, `contracts`, `staff`, or the Vietnamese names
`Khách hàng`, `Hợp đồng`, `Nhân viên`); other tabs are ignored and named in the report. The first row is the headers, matched to
fields by name without regard to accents, case or punctuation, so `Mã khách hàng`, `ma_khach_hang` and `Customer code` are the same.
The names each field answers to are in `packages/shared/src/import/import.domain.ts` (`IMPORT_COLUMNS`); a field takes the first of
its names that the file has. GymMaster's own names come first (received 2026-10-15, doc 32 §2).

### GymMaster's exports (M9.2b)

GymMaster exports each report as its own file with one tab called *Worksheet*. Give them all at once; each is recognised by its
headers (A-301), and the report's **Files** tab says what each was taken for:

| GymMaster export | Taken as |
|---|---|
| Thông tin hội viên | customers |
| Danh sách hợp đồng | contracts (and the members it names that the members' file lacks, A-304) |
| Báo cáo booking, Báo cáo thu chi, PT Training Report | not imported (OQ-078) |

In the contracts export (A-302, A-303): the value is *Tổng thanh toán* (after discounts); sessions are *Số buổi thẻ gạch* plus the bonus
*Số buổi KM*; an empty *Số buổi đã tập* comes from *Số buổi còn lại*; *Loại HĐ* gives New or Renew; *Nhân viên PT* and *Nhân viên Sale*
("Name (100%)") become the contract's shares when one employee has that name; `30/11/-0001` is an empty date.

`pnpm --filter api import:template out.xlsx` writes the blank workbook with every header.

| Tab | Field (required in bold) | Notes |
|---|---|---|
| customers | **legacy code**, **full name**, **phone**, email, date of birth | A phone already in the system is a duplicate, not a new person (D-019) |
| staff | **legacy code**, **full name**, phone, email, trainer (PT) | Created as active employees; trainers can be booked |
| contracts | **legacy code**, **customer legacy code**, **package name**, service, contract date, **start date**, **end date**, **sessions**, **sessions used**, **contract value**, **paid** | One row per contract still running |

Days are `dd/MM/yyyy` or Excel dates; money is whole dong (`12.000.000` is read as 12000000).

## 2. What the import does to a contract

- The contract keeps its **legacy code** (a column of its own); it gets a code of this system.
- **Sessions used** and **paid** become the contract's opening balances (D-011): sessions left, paid and debt are then derived as for
  any contract (T-050). No receipts or sessions are invented.
- It is **attached to a service**: the one named in the row, else the one whose name starts the package name, among the services of
  the branch. It is **renamed by its real session count** (`PT 24 buổi` becomes `PT 30 buổi` when the row says 30 sessions), and the
  old name is kept in the contract's note.
- It is approved at once, as imported (`is_imported`), and audited (`contract.imported`).

### The cleanup list (D-039)

A contract is on the owner's list, with the reason, when:

| Reason | Meaning |
|---|---|
| `SESSIONS_DIFFER_FROM_NAME` | The number in the package name is not the sessions (24 recorded as 30; 110 as 217) |
| `PRICE_DIFFERS_FROM_TIER` | Value ÷ sessions is not the unit price of the service's tier on the contract date (the contract is marked as an exception price) |
| `NO_SERVICE` | No service of the branch matched |
| `NO_TIER` | The service has no tier for that count of sessions |
| `SESSIONS_LEFT_DIFFER` | GymMaster's sessions left are not bought + bonus − used (M9.2b) |
| `DEBT_DIFFERS` | GymMaster's debt is not value − paid (M9.2b) |
| `NOT_APPROVED_IN_SOURCE` | GymMaster shows the contract *Chưa duyệt* (A-305) |
| `STAFF_NOT_FOUND` | A PT or Sale name matches no employee, or several (A-303) |

The list is the **Cleanup** tab of the report and is stored with the run (`import_runs.cleanup`). The contract is still imported;
the owner confirms or corrects the list, and a correction is a change voucher or a delete and re-create like any other (D-022).

## 3. Running it

```bash
pnpm --filter api import:gymmaster -- --file gymmaster.xlsx --user admin@flow.vn --branch "Flow Q1" --report dry-run.xlsx
pnpm --filter api import:gymmaster -- --file gymmaster.xlsx --user admin@flow.vn --branch "Flow Q1" --report done.xlsx --commit
# GymMaster's exports, as they come: each file, or a folder of them
pnpm --filter api import:gymmaster -- --dir exports/ --user admin@flow.vn --report dry-run.xlsx
```

The command needs the API's settings in its environment (`apps/api/.env`).

- `--user` is an Admin with every branch; the records say they were made by this account.
- `--branch` is a name or id; it may be left out when there is only one active branch.
- The report has four tabs: **Summary** (counts by tab and result), **Files** (what each file was taken for), **Cleanup**, **Left out**
  (rows rejected or duplicate, with the reason and the file).

### Results of a row

| Result | Meaning |
|---|---|
| Create | Will be (or was) written |
| Already imported | Its legacy code is already in the system: skipped, so a run can be repeated |
| Duplicate | The phone belongs to a customer already in the system, or to an earlier row of the file |
| Rejected | A required value is missing or wrong (`field:code`): the row is left out and listed |

A commit writes each record on its own, customers first, then staff, then contracts (a contract needs its customer). If it stops,
run it again: what was written is skipped by its legacy code. A real run is recorded in `import_runs` and in the audit history.

## 4. Reconciliation (AC-22)

```bash
pnpm --filter api import:reconcile -- --file gymmaster.xlsx --report reconcile.xlsx
```

It compares **customers, contracts, contract value, paid and sessions left** three ways: the workbook, the system (the records
that came over, as they were brought over), and the totals GymMaster shows. Add a tab named `totals` (or `Đối soát`) with the
headers `Số khách hàng`, `Số hợp đồng`, `Tổng giá trị hợp đồng`, `Tổng đã thanh toán`, `Tổng số buổi còn lại` and **one row of GymMaster's
own figures**; without it only the workbook and the system are compared.

The report has **Totals** (one line each, OK or LỆCH), **Contracts** (missing in the system, or different from their row, with
`workbook → system`) and **Customers** (missing). The command prints `MATCHES` and exits 0, or prints `DIFFERENCES: do not cut over`
and exits 1. Every line must agree before the cut-over.

## 5. Production

A real run in production is refused unless `--confirm-production` is added: that flag is the owner's sign-off (OQ-014). A dry run
is always allowed. **Take a database backup first**: the import is not undone record by record, the way back is the backup.

## 6. Cut-over and parallel run (checklist)

| # | When | Step | Who | Done when |
|---|---|---|---|---|
| 1 | Staging | The anonymized GymMaster exports are received and their header names are added (OQ-069) | Developer | A dry run has no `missingColumns` |
| 2 | Staging | Dry run; the **Cleanup** tab goes to the owner | Developer, owner | The owner has confirmed or corrected every line (OQ-014) |
| 3 | Staging | Real run, then `import:reconcile` with GymMaster's totals | Developer | `MATCHES` |
| 4 | Staging | Spot-check 20 customers by hand: sessions left, paid, debt, end date against GymMaster | Fitness Manager | No difference |
| 5 | Staging | PT revenue report against the GymMaster `employee_pt_training` export (AC-18, OQ-053) | Accountant | Figures agree |
| 6 | Before | Staff are trained; accounts, roles and approvers are set up on production | Admin | Each role has signed in |
| 7 | Day | Agree the freeze time: GymMaster takes no new contract or receipt after it | Owner | Written down |
| 8 | Day | Final export; **database backup**; dry run on production | Developer | Report read, cleanup unchanged or confirmed |
| 9 | Day | Real run on production with `--confirm-production`; `import:reconcile` | Developer | `MATCHES` |
| 10 | Day | Open the system to staff; fingerprint and email settings checked | Admin | First check-in and first email work |
| 11 | Parallel | Every day, new contracts, receipts and sessions are entered in both; the day's receipts are compared | Reception, accountant | No difference, or each difference explained |
| 12 | Parallel | Weekly: revenue, new contracts and sessions used compared | Accountant | Agree |
| 13 | End | After the days agreed with the owner without a difference (OQ-070), the owner signs off and GymMaster is switched to read-only | Owner | Signed |

If step 3, 9 or the first days of the parallel run show a difference nobody can explain, stop: restore the backup of step 8 and
look again.

## 7. Not in M9.2 or M9.3

Receipts one by one and the booking history (the opening balances stand in for them, D-011), the consulting leads Excel,
customers' health data and documents, and the reconciliation report (M9.3). See OQ-069.
