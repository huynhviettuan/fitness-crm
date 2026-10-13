import { z } from "zod";
import { instant, pageOf } from "../validation/index.js";

/**
 * In-app notifications (FR-PLT-009, brief §8.2). The kind is code; the web app turns
 * it and its params into text in the user's language, so nothing is stored translated.
 */
export const NOTIFICATION_KINDS = [
  "taskAssigned",
  "taskAccepted",
  "taskCompleted",
  "taskCancelled",
  "taskCommented",
  "taskMentioned",
  "taskDueSoon",
  "taskOverdue",
  "approvalSubmitted",
  "approvalDecided",
  "approvalOverdue",
  // Leads (brief §4.1): managers hear of new leads, consultants of leads given to them.
  "leadNew",
  "leadAssigned",
  "leadReclaimed",
  // A consulting step's deadline has come (FR-LEAD-004).
  "leadStepDue",
  // A lead entered re-care (BR-204), or a person wrote again (BR-202): the consultant and managers hear of it.
  "leadRecare",
  "leadInquiry",
  // Two records of one person were merged (A-064): the person in charge of the survivor hears of it.
  "personMerged",
  // A contract has been deactivated for more than the reminder days (D-023).
  "contractFrozenLong",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Values a notification's text fills in, e.g. a task's title or who commented. */
export type NotificationParams = Record<string, string>;

export const listNotificationsSchema = z.object({
  unreadOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .prefault(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const notificationSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(NOTIFICATION_KINDS),
    params: z.record(z.string(), z.string()),
    /** The page it is about, e.g. /tasks/{id}; null when there is none. */
    link: z.string().nullable(),
    readAt: instant.nullable(),
    createdAt: instant,
  })
  .meta({ id: "Notification" });

export const notificationPageSchema = pageOf(notificationSchema).meta({ id: "NotificationPage" });

export const notificationSummarySchema = z.object({ unread: z.int() }).meta({ id: "NotificationSummary" });

export type Notification = z.output<typeof notificationSchema>;
