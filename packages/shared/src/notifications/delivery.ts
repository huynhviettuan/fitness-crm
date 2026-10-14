import { z } from "zod";
import type { EmailLocale } from "../mail/mail.domain.js";
import { type NotificationKind, type NotificationParams } from "./notification.schema.js";

// Staff notifications outside the system (M6.4, D-053, D-056; A-183 to A-187): email and a push to the phone for the
// important events, chosen by each employee, with the mandatory ones marked by Admin. Pure rules, shared by the API, the
// settings screens and the tests.

/**
 * The kinds that also go out by email and to the phone (D-053): a task near its reminder points or overdue, an approval
 * waiting or overdue, a lead newly assigned or moved, and a session that lacks a full check-in (D-071). The escalation of a
 * workout session joins them with the workout log (M7). Every kind appears in the app whatever these say.
 */
export const EXTERNAL_NOTIFICATION_KINDS = [
  "taskDueSoon",
  "taskOverdue",
  "approvalSubmitted",
  "approvalOverdue",
  "leadAssigned",
  "leadReclaimed",
  "sessionHanging",
] as const satisfies readonly NotificationKind[];
export type ExternalNotificationKind = (typeof EXTERNAL_NOTIFICATION_KINDS)[number];

export function isExternalKind(kind: string): kind is ExternalNotificationKind {
  return (EXTERNAL_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/** The two ways out of the app. */
export const DELIVERY_CHANNELS = ["EMAIL", "PUSH"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** What one employee chose for one kind. Until they choose, both are on (D-053). */
export type ChannelChoice = { email: boolean; push: boolean };
export const DEFAULT_CHOICE: ChannelChoice = { email: true, push: true };

/** What Admin made mandatory for one kind: it goes out whatever the employee chose. */
export type MandatoryChoice = { email: boolean; push: boolean };

/**
 * The channels a notification goes out by: what the employee chose, or what is mandatory. A push goes only to an
 * employee who has the app on a phone (a subscription), whatever they chose.
 */
export function channelsFor(
  choice: ChannelChoice | null,
  mandatory: MandatoryChoice | null,
  hasPushSubscription: boolean,
): DeliveryChannel[] {
  const chosen = choice ?? DEFAULT_CHOICE;
  const channels: DeliveryChannel[] = [];
  if (chosen.email || mandatory?.email) channels.push("EMAIL");
  if ((chosen.push || mandatory?.push) && hasPushSubscription) channels.push("PUSH");
  return channels;
}

type Words = Record<NotificationKind, string>;

/** The sentence of every notification, as the app shows it (messages `notifications.kinds`): the email and the push say the same. */
export const NOTIFICATION_TEXTS: Record<EmailLocale, Words> = {
  vi: {
    taskAssigned: '{by} giao cho bạn việc "{title}"',
    taskAccepted: '{by} đã nhận việc "{title}"',
    taskCompleted: '{by} đã hoàn thành việc "{title}"',
    taskCancelled: 'Việc "{title}" đã bị hủy',
    taskCommented: '{by} bình luận trong việc "{title}"',
    taskMentioned: '{by} nhắc đến bạn trong việc "{title}"',
    taskDueSoon: 'Việc "{title}" còn {hours} giờ nữa đến hạn ({due})',
    taskOverdue: 'Việc "{title}" đã quá hạn ({due})',
    approvalSubmitted: "Có yêu cầu chờ bạn duyệt: {title}",
    approvalDecided: 'Yêu cầu "{title}": {status}',
    approvalOverdue: "Yêu cầu chờ duyệt đã quá hạn: {title}",
    leadNew: "Lead mới {code} · {name}",
    leadAssigned: "Bạn được giao lead {code} · {name}",
    leadStepDue: "Đến hạn: {step} · lead {code} · {name}",
    leadRecare: "Lead {code} · {name} cần tái chăm sóc",
    leadInquiry: "{name} ({code}) vừa liên hệ lại",
    personMerged: "Hồ sơ {mergedCode} đã được gộp vào {code} · {name}",
    leadReclaimed: "Lead {code} · {name} đã chuyển cho người khác vì {minutes} phút chưa được chăm sóc",
    contractFrozenLong: "Hợp đồng {code} của {name} đã bị khóa quá {days} ngày.",
    sessionHanging: "Buổi tập của {customer} với {trainer} vẫn thiếu check-in sau {hours} giờ.",
  },
  en: {
    taskAssigned: '{by} gave you the task "{title}"',
    taskAccepted: '{by} accepted the task "{title}"',
    taskCompleted: '{by} completed the task "{title}"',
    taskCancelled: 'The task "{title}" was cancelled',
    taskCommented: '{by} commented on the task "{title}"',
    taskMentioned: '{by} mentioned you in the task "{title}"',
    taskDueSoon: 'Task "{title}" is due in {hours} hours ({due})',
    taskOverdue: 'The task "{title}" is overdue ({due})',
    approvalSubmitted: "A request waits for your approval: {title}",
    approvalDecided: 'Request "{title}": {status}',
    approvalOverdue: "A request waiting for approval is overdue: {title}",
    leadNew: "New lead {code} · {name}",
    leadAssigned: "Lead {code} · {name} was assigned to you",
    leadStepDue: "Due: {step} · lead {code} · {name}",
    leadRecare: "Lead {code} · {name} is due for re-care",
    leadInquiry: "{name} ({code}) got in touch again",
    personMerged: "Record {mergedCode} was merged into {code} · {name}",
    leadReclaimed: "Lead {code} · {name} was moved to someone else after {minutes} minutes without care",
    contractFrozenLong: "Contract {code} of {name} has been deactivated for more than {days} days.",
    sessionHanging: "Session of {customer} with {trainer} still lacks a full check-in after {hours} hours.",
  },
};

/** The sentence of a notification in a language; a value that is missing is left out. */
export function notificationText(kind: NotificationKind, params: NotificationParams, locale: EmailLocale): string {
  const step = locale === "vi" ? params.stepVi : params.stepEn;
  const filled: Record<string, string> = { ...params, step: step ?? params.step ?? "" };
  return NOTIFICATION_TEXTS[locale][kind].replace(/\{(\w+)\}/g, (_, name: string) => filled[name] ?? "");
}

/** The title of the email and of the push: the app's name and what kind of thing it is. */
export const NOTIFICATION_TITLES: Record<EmailLocale, Record<ExternalNotificationKind, string>> = {
  vi: {
    taskDueSoon: "Việc sắp đến hạn",
    taskOverdue: "Việc quá hạn",
    approvalSubmitted: "Yêu cầu chờ duyệt",
    approvalOverdue: "Yêu cầu duyệt quá hạn",
    leadAssigned: "Lead mới được giao",
    leadReclaimed: "Lead đã chuyển người",
    sessionHanging: "Buổi tập thiếu check-in",
  },
  en: {
    taskDueSoon: "Task due soon",
    taskOverdue: "Task overdue",
    approvalSubmitted: "Request waiting for approval",
    approvalOverdue: "Approval overdue",
    leadAssigned: "Lead assigned to you",
    leadReclaimed: "Lead moved to someone else",
    sessionHanging: "Session without a full check-in",
  },
};

export function notificationTitle(kind: ExternalNotificationKind, locale: EmailLocale): string {
  return NOTIFICATION_TITLES[locale][kind];
}

// ------------------------------------------------------------------------------------------------ preferences

const kind = z.enum(EXTERNAL_NOTIFICATION_KINDS, { error: "invalidChoice" });

/** One kind in the employee's preferences, with what Admin made mandatory. */
export const notificationPreferenceSchema = z.object({
  kind: z.enum(EXTERNAL_NOTIFICATION_KINDS),
  email: z.boolean(),
  push: z.boolean(),
  emailMandatory: z.boolean(),
  pushMandatory: z.boolean(),
});

export const notificationPreferencesSchema = z
  .object({
    items: z.array(notificationPreferenceSchema),
    /** This account has the app on at least one phone or browser that can be pushed to. */
    pushDevices: z.int(),
  })
  .meta({ id: "NotificationPreferences" });

export const notificationPreferencesInputSchema = z.object({
  items: z
    .array(
      z.object({ kind, email: z.boolean({ error: "invalidChoice" }), push: z.boolean({ error: "invalidChoice" }) }),
    )
    .max(EXTERNAL_NOTIFICATION_KINDS.length, { error: "tooMany" })
    .refine((items) => new Set(items.map((item) => item.kind)).size === items.length, { error: "duplicate" }),
});

/** Admin's mandatory marks (D-053). */
export const notificationSettingsSchema = z
  .object({
    items: z.array(
      z.object({ kind: z.enum(EXTERNAL_NOTIFICATION_KINDS), emailMandatory: z.boolean(), pushMandatory: z.boolean() }),
    ),
  })
  .meta({ id: "NotificationSettings" });

export const notificationSettingsInputSchema = z.object({
  items: z
    .array(
      z.object({
        kind,
        emailMandatory: z.boolean({ error: "invalidChoice" }),
        pushMandatory: z.boolean({ error: "invalidChoice" }),
      }),
    )
    .max(EXTERNAL_NOTIFICATION_KINDS.length, { error: "tooMany" })
    .refine((items) => new Set(items.map((item) => item.kind)).size === items.length, { error: "duplicate" }),
});

/** A phone or browser that can be pushed to (the Web Push API's subscription). */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url({ protocol: /^https$/, error: "invalidUrl" }).max(2048, { error: "tooLong" }),
  keys: z.object({
    p256dh: z.string().min(16, { error: "required" }).max(256, { error: "tooLong" }),
    auth: z.string().min(8, { error: "required" }).max(128, { error: "tooLong" }),
  }),
});

export const pushRemoveInputSchema = z.object({
  endpoint: z.url({ protocol: /^https$/, error: "invalidUrl" }).max(2048),
});

/** The public key the browser needs to subscribe; empty while push is not set up. */
export const pushKeySchema = z.object({ publicKey: z.string() }).meta({ id: "PushKey" });

export type NotificationPreference = z.output<typeof notificationPreferenceSchema>;
export type NotificationPreferences = z.output<typeof notificationPreferencesSchema>;
export type NotificationPreferencesInput = z.input<typeof notificationPreferencesInputSchema>;
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;
export type NotificationSettingsInput = z.input<typeof notificationSettingsInputSchema>;
export type PushSubscriptionInput = z.input<typeof pushSubscriptionInputSchema>;
