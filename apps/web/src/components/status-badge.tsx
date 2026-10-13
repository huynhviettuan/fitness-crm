import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

type BadgeVariant = "success" | "warning" | "info" | "muted" | "destructive";

// The only status → color mapping in the app (docs/23 §3). Add entities here as
// their phase is built.
const STATUS_VARIANTS = {
  customer: { ACTIVE: "success", INACTIVE: "muted" },
  // D-020: open journeys in info and warning colors, re-care cases in muted, outcomes in their own.
  lead: {
    NEW: "info",
    CONSULTING: "info",
    CONSIDERING: "warning",
    NO_RESPONSE: "muted",
    BOOKED: "warning",
    SHOWED: "success",
    NO_SHOW: "destructive",
    REFUSED: "muted",
    CONTRACTED: "success",
  },
  // FR-LEAD-004: a step waits for its trigger, is open with a deadline, or is done; or locked as "Không thực hiện" (D-054).
  leadStep: { WAITING: "muted", OPEN: "info", DONE: "success", NOT_DONE: "destructive" },
  stepTiming: { ON_TIME: "success", LATE: "destructive" },
  user: { ACTIVE: "success", DISABLED: "muted" },
  contract: {
    DRAFT: "warning",
    ACTIVE: "success",
    EXPIRED: "warning",
    CANCELLED: "muted",
    REJECTED: "destructive",
    FROZEN: "info",
  },
  // D-040: a customer's standing, derived from their contracts.
  customerContract: {
    NO_CONTRACT: "muted",
    TRAINING: "success",
    EXPIRING_SOON: "warning",
    EXPIRED: "destructive",
    ON_HOLD: "info",
  },
  employee: { ACTIVE: "success", INACTIVE: "muted" },
  booking: { BOOKED: "info", CHECKED_IN: "warning", COMPLETED: "success", CANCELLED: "muted", NO_SHOW: "destructive" },
  branch: { ACTIVE: "success", INACTIVE: "muted" },
  option: { ACTIVE: "success", INACTIVE: "muted" },
  // D-018: only an approved record has an effect.
  approval: { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "muted" },
  login: { SUCCESS: "success", FAILED: "destructive" },
  task: { NEW: "info", ACCEPTED: "warning", IN_PROGRESS: "warning", DONE: "success", CANCELLED: "muted" },
  taskPriority: { LOW: "muted", NORMAL: "info", HIGH: "destructive" },
  // D-036: a customer email waits to be sent, was sent, or could not be.
  email: { QUEUED: "info", SENT: "success", FAILED: "destructive" },
} as const satisfies Record<string, Record<string, BadgeVariant>>;

// Larger surfaces in a status color, e.g. booking blocks in the PT calendar.
const SURFACE_CLASSES: Record<BadgeVariant, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  muted: "border-border bg-muted text-muted-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
};

type Entity = keyof typeof STATUS_VARIANTS;
type StatusOf<E extends Entity> = keyof (typeof STATUS_VARIANTS)[E] & string;

type StatusBadgeProps<E extends Entity> = {
  entity: E;
  status: StatusOf<E>;
};

function variantOf<E extends Entity>(entity: E, status: StatusOf<E>): BadgeVariant {
  return (STATUS_VARIANTS[entity] as Record<string, BadgeVariant>)[status];
}

/** Always a text label plus a color, never color alone. */
export function StatusBadge<E extends Entity>({ entity, status }: StatusBadgeProps<E>) {
  const t = useTranslations("status");
  return <Badge variant={variantOf(entity, status)}>{t(`${entity}.${status}` as Parameters<typeof t>[0])}</Badge>;
}

/** Border, background, and text classes for a surface in the status's color. */
export function statusSurfaceClass<E extends Entity>(entity: E, status: StatusOf<E>): string {
  return SURFACE_CLASSES[variantOf(entity, status)];
}
