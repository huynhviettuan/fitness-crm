# 23 — UI Design System

The goal is an interface that is **modern, simple, and consistent**: every screen is built from the same components, colors, and patterns. This document is binding for every UI task (T-025, T-026, T-027).

## 1. Stack

| Need | Choice | Notes |
|---|---|---|
| Components | shadcn/ui (Radix + Tailwind CSS) | Generated into `src/components/ui/`; we own the code. No second component library. |
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
- Tokens are defined only in `src/app/globals.css`.
- Light theme only in V1. The tokens stay dark-ready, but there is no theme toggle.
- Add semantic tokens `success`, `warning`, and `info` next to shadcn's `destructive` and `muted`.
- Feature code uses tokens and component variants only. Never raw palette classes such as `bg-green-500` or hex values.
- Prefer whitespace and simple borders over heavy shadows, gradients, or dense layouts (see `08_UI_UX_SPECIFICATION.md`).

## 3. Status colors

`StatusBadge` is the only component that maps a status to a color.

| Entity | Status | Color token |
|---|---|---|
| Booking | `BOOKED` | info |
| Booking | `CHECKED_IN` | warning |
| Booking | `COMPLETED` | success |
| Booking | `CANCELLED` | muted |
| Booking | `NO_SHOW` | destructive |
| Contract | `DRAFT` | muted |
| Contract | `ACTIVE` | success |
| Contract | `EXPIRED` (derived) | warning |
| Contract | `CANCELLED` | muted |
| Payment / cash transaction | `CONFIRMED` | success |
| Payment / cash transaction | `VOIDED` | muted, amount struck through |
| Customer | `ACTIVE` | success |
| Customer | `INACTIVE` | muted |
| User | `ACTIVE` | success |
| User | `DISABLED` | muted |

A status is always shown as a translated text label plus color, never color alone.

## 4. Languages

- Locales: `vi` and `en` (T-027). Default `vi` (A-011).
- URLs have no locale prefix; `/customers` is the same page in both languages (next-intl without i18n routing).
- Each user's language is stored as `user.locale`, because reception PCs are shared by several staff. The login page uses the browser language and falls back to the default.
- The language switch is in the user menu.
- Every user-facing string lives in `messages/vi.json` and `messages/en.json`. Components contain no hard-coded text.
- Enums and codes stay in English in the database and API. The UI translates them with keys such as `status.booking.COMPLETED`.
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

```text
┌──────────────┬──────────────────────────────────────────────┐
│  Gym logo    │  Page title          [Search Ctrl+K]  [User] │
│              ├──────────────────────────────────────────────┤
│  Dashboard   │                                              │
│  Customers   │                                              │
│  Contracts   │                 page content                 │
│  PT Calendar │                                              │
│  Sessions    │                                              │
│  Finance     │                                              │
│  Reports     │                                              │
│  Admin       │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- Collapsible shadcn Sidebar with the navigation from `08_UI_UX_SPECIFICATION.md`. Items a role cannot use are hidden. This is UX only; the server enforces access.
- Top bar: page title, global customer search, and the user menu.
- Global customer search uses shadcn Command (Ctrl+K) and matches code, name, or phone (FR-CUS-002).
- User menu: name, role, language switch, sign out.

## 7. Page templates

| Page type | Structure |
|---|---|
| List | `PageHeader` (title + primary action) → filter bar → `DataTable` → `EmptyState` when there are no rows |
| Detail | Header (code, name, `StatusBadge`, actions) → Tabs |
| Short form (≤ 6 fields, e.g. booking, payment) | Dialog or Sheet |
| Long form (e.g. contract) | Full page |
| Dashboard | Grid of KPI cards, then charts and widgets |

Critical actions (complete session, cancel, no-show, void, contract cancel) use `ConfirmDialog`, which states the effect before the user confirms — for example "Remaining sessions: 16 → 15". Void asks for a reason.

## 8. Shared components

Each cross-cutting concern has exactly one owner in `src/components/`. Feature code composes these and never re-implements them.

| Component | Owns |
|---|---|
| `PageHeader` | Page title, description, primary action |
| `DataTable` | Table, toolbar, server-side pagination, sorting, row actions |
| `EmptyState` | "Nothing here yet" message and its call to action |
| Loading skeletons + `loading.tsx` | Loading states |
| `ErrorState`, `toUserMessage(code)` | Showing errors; error code → translated message |
| `ConfirmDialog` | Confirmation for critical actions |
| `StatusBadge` | Status label and color (§3) |
| `Money` | Money display (§5) |
| `DateTime` | Date/time display in the gym timezone (§5) |
| `notify` | Toasts (wraps Sonner) |
| Form field wrappers | Label, input, help text, and error message layout |

## 9. PT booking calendar

`TrainerScheduleGrid` is a custom component built from shadcn primitives. It uses no calendar library.

- One day at a time, with a date selector.
- Trainers as columns, filterable; 30-minute rows. The visible hours come from `SCHEDULE_START_HOUR` and `SCHEDULE_END_HOUR` (default 6–22); the grid grows to show a booking outside them.
- Only active bookings (A-005) are drawn. Cancelled and no-show bookings free the slot and are listed under Sessions.
- A trainer sees only their own column (A-007).
- Booking blocks use the `StatusBadge` colors and show customer and time.
- Clicking an empty slot opens the create-booking dialog with trainer and time filled in.
- Clicking a booking opens a detail Sheet with the actions allowed by its status (A-006).
- No drag-and-drop in V1; rescheduling uses the dialog.

Why custom: FullCalendar's trainer-column (resource) view is a paid add-on, and react-big-calendar needs heavy restyling to match shadcn/ui. A one-day grid for one gym is small enough to own.

## 10. Devices

Device targets (A-012):

- Desktop-first, 1280px and wider (gym PCs, latest Chrome/Edge).
- Every screen remains usable at tablet width.
- The trainer's day view and the check-in and complete actions work at phone width (360px and wider).

## 11. Accessibility and testability

- Radix provides correct roles and keyboard support. Every interactive element has an accessible name.
- Playwright tests locate elements with `getByRole` / `getByLabel`, scoped to the owning region (dialog, table row, page section), never a page-global lookup.
- `data-testid` is used only where role and name are ambiguous, such as booking blocks in the calendar.
- E2E tests run with the locale pinned to `vi` and resolve labels from the message catalog instead of hard-coding text.
- Toasts appear in one shared live region named by `common.notifications` ("Thông báo"). Tests find a toast inside that region and check it right after the action, because a toast disappears after a few seconds.
- The layout has exactly one `banner` (the top bar) and one `main` landmark; tests scope page content to `main`.

## 12. Rules for AI agents and developers

Do:

- Build screens only from `src/components/ui` and the shared components in §8.
- Use the page templates in §7.
- Put every new string in both `messages/vi.json` and `messages/en.json`.

Do not:

- Add another UI, styling, icon, or calendar library.
- Use raw palette classes, hex colors, or inline styles for color.
- Hard-code user-facing text.
- Format money or dates outside `Money` / `DateTime`.
- Create a second toast, error, loading, pagination, or status-badge implementation.
