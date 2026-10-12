# 23 — UI Design System

The goal is an interface that is **modern, simple, and consistent**: every screen is built from the same components, colors, and patterns. This document is binding for every UI task (T-025, T-026, T-027).

## 1. Stack

| Need | Choice | Notes |
|---|---|---|
| Components | shadcn/ui (Radix + Tailwind CSS) | Generated into `apps/web/src/components/ui/`; we own the code. No second component library. |
| Icons | `lucide-react` | shadcn default. |
| Forms | `react-hook-form` + `@hookform/resolvers/zod` | Forms reuse the server's Zod schemas for instant feedback. The server still re-validates; client validation is only UX. |
| Tables | TanStack Table, via the shadcn Data Table pattern | Pagination, search, and sort run on the server. |
| Toasts | Sonner | shadcn default. |
| Charts | shadcn Chart (Recharts) | Dashboard and reports. |
| Date picker | shadcn Calendar (react-day-picker) | `vi` and `en` locales. |
| Date arithmetic | `date-fns` v4 + `@date-fns/tz` | Always in `GYM_TIMEZONE` (A-001). |
| Translations | `next-intl` | See §4. |
| Font | Inter via `next/font/google` | Subsets `latin` and `vietnamese`, so diacritics render correctly. |

Adding any other UI, styling, or calendar library requires updating this document and `18_DECISIONS_ASSUMPTIONS.md` first.

## 2. Look and tokens

- Neutral base palette with one accent color, `--primary`. The gym's brand color, if any, is applied by changing that one token.
- shadcn default radius, spacing, and typography scale.
- Tokens are defined only in `apps/web/src/app/globals.css`.
- Light theme only in V1. The tokens stay dark-ready, but there is no theme toggle.
- Add semantic tokens `success`, `warning`, and `info` next to shadcn's `destructive` and `muted`.
- Feature code uses tokens and component variants only. Never raw palette classes such as `bg-green-500` or hex values.
- Prefer whitespace and simple borders over heavy shadows, gradients, or dense layouts (see `08_UI_UX_SPECIFICATION.md`).

## 3. Status colors

`StatusBadge` is the only component that maps a status to a color. Colors are **tokens**, never raw palette values.

- **Configurable statuses** take their color from configuration (D-015, T-049): session statuses (`session_status_rules`), and any status admin can recolor. Admin picks a token from a fixed palette (`info`, `success`, `warning`, `destructive`, `muted`, `violet`, `red`), so contrast stays correct.
- **Fixed statuses** map in code.

Initial session colors (brief §6.2):

| Session status | Token |
|---|---|
| Booked | `red` |
| Đã tập | `info` (blue) |
| Hủy lịch | `violet` |
| Khách không đến | `warning` (yellow) |

Fixed mappings:

| Entity | Status | Token |
|---|---|---|
| Contract | Pending approval | `warning` |
| Contract | Active | `success` |
| Contract | Frozen (Tạm vô hiệu) | `destructive` |
| Contract | On hold (Bảo lưu) | `info` |
| Contract | Expired (derived) | `muted` |
| Contract | Cancelled | `muted` |
| Lead | New, Consulting, Considering, No response, Appointment booked, Show, No show, Refused, Contracted | `info`, `info`, `warning`, `muted`, `info`, `success`, `destructive`, `muted`, `success` |
| Approval | Pending / Approved / Rejected | `warning` / `success` / `destructive` |
| Task | New, Accepted, In progress, Done, Cancelled | `info`, `info`, `warning`, `success`, `muted` |
| Email | Sent / Failed | `success` / `destructive` |
| Receipt / expense voucher | Pending / Approved | `warning` / `success`; deleted vouchers appear only in the trash |
| Customer (derived) | Training, Expiring soon, Expired, On hold, No contract | `success`, `warning`, `muted`, `info`, `muted` |

A status is always shown as a translated text label plus color, never color alone. The tokens `red` and `violet` are added to `globals.css` with light and dark values.

## 4. Languages

- Locales: `vi` and `en` (T-027). Default `vi` (A-011).
- URLs have no locale prefix; `/customers` is the same page in both languages (next-intl without i18n routing).
- Each user's language is stored as `user.locale`, because reception PCs are shared by several staff. The login page uses the browser language and falls back to the default.
- The language switch is in the user menu.
- Every user-facing string lives in `messages/vi.json` and `messages/en.json`. Components contain no hard-coded text.
- Enums and codes stay in English in the database and API. The UI translates them with keys such as `status.contract.ACTIVE`. Admin-managed option lists carry their own Vietnamese and English labels (D-016).
- API error codes (`07_API_SPECIFICATION.md`) map to `errors.<CODE>` message keys. `toUserMessage(code)` is the only place that does this.

## 5. Formatting

The same formats apply in both languages, so a shared PC never shows two date styles:

| Value | Format | Owner |
|---|---|---|
| Date | `dd/MM/yyyy` | `<DateTime>` / `formatDate` |
| Time | 24-hour `HH:mm` | `<DateTime>` / `formatTime` |
| Timezone | Always the gym timezone, never the browser's | `<DateTime>` |
| Money | VND, 0 decimals, separators by locale (`12.000.000 ₫` in `vi`) | `<Money>` / `formatMoney` |

Never format money or dates anywhere else.

## 6. App shell

- Collapsible shadcn Sidebar with the navigation groups from `08_UI_UX_SPECIFICATION.md`, built from `lib/navigation.ts` (A-105): groups open and close (shadcn Collapsible), only the group of the current page is open at first, and the user's choice is remembered in the browser. With only the icons showing, a click on a group widens the sidebar. Items without permission are hidden, and so is a group left with none; the API enforces access (D-017).
- Top bar: page title, branch switcher, global customer search (Ctrl+K: code, name, phone), approvals inbox, notification bell, user menu (name, role, language, sign out).
- On phones the sidebar becomes a sheet and the top bar keeps search and notifications.

## 7. Page templates

| Page type | Structure |
|---|---|
| List (brief §1) | `PageHeader` (title, **Add**, **Export Excel**) → `FilterPanel` on the left + search → `DataTable` with paging and a **totals row** → `EmptyState` when there are no rows |
| Detail | Header (code, name, `StatusBadge`, actions allowed by permission and status) → Tabs |
| Board | Kanban by status (leads) |
| Short form (≤ 6 fields) | Dialog or Sheet |
| Long form (contract, workout plan) | Full page, grouped sections |
| Phone-first (leads, PT calendar, session log) | Single column, sticky actions, large touch targets |
| Dashboard | Grid of KPI cards, then charts and widgets |

Critical actions (Đã tập, delete, deactivate, approve, cancel) use `ConfirmDialog`, which states the effect before the user confirms — for example "Sessions left: 16 → 15". Deletions and rejections ask for a reason from a drop-down.

## 8. Shared components

Each cross-cutting concern has exactly one owner in `apps/web/src/components/`. Feature code composes these and never re-implements them.

| Component | Owns |
|---|---|
| `PageHeader` | Page title, description, primary action |
| `DataTable` | Table, toolbar, server-side pagination, sorting, row actions |
| `BarChart` | The shared chart of the dashboards, over the shadcn Chart (`components/ui/chart.tsx`, Recharts): horizontal grouped bars in the theme's chart colors (five distinct hues, `--chart-1` blue to `--chart-5` red; a single-series chart such as the funnel colors each group), with the chart's label for people who cannot see it. A chart always has its figures in a table beside it (A-094) |
| `ExportButton` | **Export Excel** of a list: downloads the list's `/api/v1/<list>/export` with the page's own search and filters, shows a refusal (such as `EXPORT_TOO_LARGE`) as a toast, and is shown only to someone with the list's export permission |
| `TablePagination` | The footer of every paginated list: the total, rows per page (10 by default; 20, 50, 100), first, previous, page numbers, next, and last. Each is a link built from the page's path and search params (`lib/paging.ts`), so filters and search are kept; a page reads `readPaging(params)` and passes `pageSize` to the API |
| `EmptyState` | "Nothing here yet" message and its call to action |
| Loading skeletons + `loading.tsx` | Loading states |
| `ErrorState`, `toUserMessage(code)` | Showing errors; error code → translated message |
| `ConfirmDialog` | Confirmation for critical actions |
| `StatusBadge` | Status label and color (§3) |
| `Money` | Money display (§5) |
| `DateTime` | Date/time display in the gym timezone (§5) |
| `notify` | Toasts (wraps Sonner) |
| Form field wrappers | Label, input, help text, and error message layout |
| `FilterPanel` | Left-side filters of list pages; state kept in the URL |
| `OptionSelect` | Drop-down from an option list, loaded when the form opens; choosing "Khác" shows a required note (D-016). Records show the choice with `ChosenOptionText` ("Khác: note") |
| `FilterPanel` | The left-hand filters of the list template: a GET form (`FilterSelect`, `FilterInput`), so the URL holds the filters and the page reads them on the server |
| `ApprovalBadge` / `ApprovalBar` | Pending state of a record and the approve/reject actions with reason |
| `ExportButton` | Excel export of the current filter (permission `*.export`) |
| `Masked` | Shows "•••" for fields hidden by the user's role (D-017) |
| `BranchSwitcher` | Current branch for users with several branches |
| `NotificationBell` | In-app notifications |
| `Timeline` | Ordered history (lead steps, contract history, audit) |

## 9. PT and class calendars

`TrainerScheduleGrid` is a custom component built from shadcn primitives. It uses no calendar library.

- Day view with back, today, and forward, plus a week view (brief §6.1).
- **One row per PT**, with the PT's session count for the day in brackets; 30-minute columns; hours from configuration (05:00–22:00 initially).
- Cells are green when bookable (inside the PT's working schedule and in the future) and grey otherwise.
- Session blocks use the configured status colors (§3) and show customer and time. Deleted sessions are not drawn.
- Filters: branch, date, PT, customer.
- Clicking a bookable cell opens the booking dialog with PT and time filled in.
- Clicking a session opens its detail with the actions allowed by status and permission. Admin also gets a bulk "Đã tập" mode for the day.
- On phones, a PT sees their own day as a vertical list of slots.
- The class grid reuses the same component with classes as blocks.

Why custom: resource (row-per-person) views are paid add-ons in FullCalendar, and other libraries need heavy restyling to match shadcn/ui.

## 10. Devices

Device targets (D-043):

- Desktop at 1280px and wider for office screens.
- Every screen usable at tablet width.
- **Phone-first** (360px and wider): leads (list, Kanban, detail, quick add), the PT calendar, and the session log, because consultants and PTs work on phones.

## 11. Accessibility and testability

- Radix provides correct roles and keyboard support. Every interactive element has an accessible name.
- Playwright tests locate elements with `getByRole` / `getByLabel`, scoped to the owning region (dialog, table row, page section), never a page-global lookup.
- `data-testid` is used only where role and name are ambiguous, such as booking blocks in the calendar.
- E2E tests run with the locale pinned to `vi` and resolve labels from the message catalog instead of hard-coding text.
- Toasts appear in one shared live region named by `common.notifications` ("Thông báo"). Tests find a toast inside that region and check it right after the action, because a toast disappears after a few seconds.
- The layout has exactly one `banner` (the top bar) and one `main` landmark; tests scope page content to `main`.

## 12. Rules for AI agents and developers

Do:

- Build screens only from `apps/web/src/components/ui` and the shared components in §8.
- Use the page templates in §7.
- Put every new string in both `messages/vi.json` and `messages/en.json`.

Do not:

- Add another UI, styling, icon, or calendar library.
- Use raw palette classes, hex colors, or inline styles for color.
- Hard-code user-facing text.
- Format money or dates outside `Money` / `DateTime`.
- Create a second toast, error, loading, pagination, or status-badge implementation.
