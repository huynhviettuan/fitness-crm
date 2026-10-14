import { nextAttemptAt, type EmailLocale } from "@flow/shared/mail";
import {
  DEFAULT_CHOICE,
  EXTERNAL_NOTIFICATION_KINDS,
  channelsFor,
  isExternalKind,
  notificationPreferencesInputSchema,
  notificationSettingsInputSchema,
  notificationText,
  notificationTitle,
  pushRemoveInputSchema,
  pushSubscriptionInputSchema,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationSettings,
} from "@flow/shared/notifications";
import { prisma, type Db } from "../db/prisma.js";
import { appOrigin } from "../env.js";
import { recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { assertCan } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";
import { configuredMailProvider, type MailProvider } from "../../modules/mail/mail.provider.js";
import { configuredPushProvider, pushPublicKey, type PushProvider } from "./push.provider.js";

// Staff notifications outside the system (M6.4, D-053, D-056; A-183 to A-187). `notify` writes the in-app notification;
// for the kinds that matter it also schedules a delivery by email and by push, per the employee's choices and Admin's
// mandatory marks. The worker sends the deliveries, with the retries of the customer emails.

const BATCH_SIZE = 50;
const LEASE_MS = 10 * 60_000;

// ------------------------------------------------------------------------------------------------ scheduling

/**
 * Schedules the deliveries of notifications just written: one row per channel the employee's choice and Admin's marks
 * allow (a push only to an employee who has a device), once per notification and channel. Kinds that stay in the app
 * schedule nothing.
 */
export async function scheduleDeliveries(
  db: Db,
  notifications: readonly { id: string; userId: string; kind: string }[],
): Promise<void> {
  const external = notifications.filter((notification) => isExternalKind(notification.kind));
  if (external.length === 0) return;
  const userIds = [...new Set(external.map((notification) => notification.userId))];
  const [preferences, settings, subscriptions, users] = await Promise.all([
    db.notificationPreference.findMany({ where: { userId: { in: userIds } } }),
    db.staffNotificationSetting.findMany(),
    db.pushSubscription.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } }),
    db.user.findMany({ where: { id: { in: userIds }, status: "ACTIVE" }, select: { id: true } }),
  ]);
  const active = new Set(users.map((user) => user.id));
  const withDevice = new Set(subscriptions.map((group) => group.userId));
  const rows = external.flatMap((notification) => {
    if (!active.has(notification.userId)) return [];
    const choice = preferences.find((p) => p.userId === notification.userId && p.kind === notification.kind) ?? null;
    const mark = settings.find((setting) => setting.kind === notification.kind) ?? null;
    return channelsFor(
      choice,
      mark ? { email: mark.emailMandatory, push: mark.pushMandatory } : null,
      withDevice.has(notification.userId),
    ).map((channel) => ({ notificationId: notification.id, userId: notification.userId, channel }));
  });
  if (rows.length > 0) await db.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
}

// ---------------------------------------------------------------------------------------------------- sending

export type DeliveryReport = { sent: number; retried: number; failed: number; skipped: number };

type Delivery = Awaited<ReturnType<typeof claimDue>>[number];

async function claimDue(now: Date) {
  const ids = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "notification_deliveries"
      WHERE "status" = 'QUEUED' AND "next_attempt_at" <= ${now}
      ORDER BY "next_attempt_at"
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return [];
    const taken = rows.map((row) => row.id);
    await tx.notificationDelivery.updateMany({
      where: { id: { in: taken } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    return taken;
  });
  return prisma.notificationDelivery.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "asc" },
    include: {
      notification: { select: { kind: true, params: true, link: true, readAt: true } },
      user: { select: { email: true, locale: true, status: true } },
    },
  });
}

function paramsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

const finish = (id: string, status: "SENT" | "FAILED" | "SKIPPED", now: Date, failure: string | null = null) =>
  prisma.notificationDelivery.updateMany({
    where: { id, status: "QUEUED" },
    data: { status, failure, sentAt: status === "SENT" ? now : null },
  });

/** Tries again later (1, 5, 30 minutes) or gives up with a failure code. */
async function retryOrFail(
  delivery: Delivery,
  failure: string,
  retry: boolean,
  now: Date,
): Promise<"retried" | "failed"> {
  const again = retry ? nextAttemptAt(delivery.attempts, now) : null;
  if (again) {
    await prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, status: "QUEUED" },
      data: { failure, nextAttemptAt: again },
    });
    return "retried";
  }
  await finish(delivery.id, "FAILED", now, failure);
  return "failed";
}

function emailBody(text: string, url: string, locale: EmailLocale): string {
  const settings = `${appOrigin}/account/notifications`;
  return locale === "vi"
    ? `${text}\n\nMở trong Flow Fitness: ${url}\n\nBạn có thể chọn loại thông báo nhận qua email và điện thoại tại ${settings}`
    : `${text}\n\nOpen in Flow Fitness: ${url}\n\nYou can choose which notifications reach you by email and on your phone at ${settings}`;
}

/**
 * Sends the deliveries that are due. A notification the employee has already read in the app, or for an account no
 * longer active, is skipped. An email or a push that fails is tried again after 1, 5 and 30 minutes and then stays
 * failed; a subscription the browser dropped is deleted. Run by the worker with the mail (T-059).
 */
export async function sendDueDeliveries(
  now: Date = new Date(),
  mail: MailProvider = configuredMailProvider(),
  push: PushProvider = configuredPushProvider(),
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  for (const delivery of await claimDue(now)) {
    const { notification, user } = delivery;
    if (user.status !== "ACTIVE" || notification.readAt || !isExternalKind(notification.kind)) {
      await finish(delivery.id, "SKIPPED", now);
      report.skipped += 1;
      continue;
    }
    const locale: EmailLocale = user.locale === "en" ? "en" : "vi";
    const kind = notification.kind as NotificationKind;
    const text = notificationText(kind, paramsOf(notification.params), locale);
    const title = notificationTitle(notification.kind, locale);
    const path = notification.link ?? "/notifications";

    if (delivery.channel === "EMAIL") {
      const result = await mail.send({
        to: user.email,
        subject: title,
        body: emailBody(text, `${appOrigin}${path}`, locale),
        idempotencyKey: delivery.id,
      });
      if (result.ok) {
        await finish(delivery.id, "SENT", now);
        report.sent += 1;
      } else {
        report[await retryOrFail(delivery, result.failure, result.retry, now)] += 1;
      }
      continue;
    }

    const devices = await prisma.pushSubscription.findMany({ where: { userId: delivery.userId } });
    if (devices.length === 0) {
      await finish(delivery.id, "SKIPPED", now);
      report.skipped += 1;
      continue;
    }
    let sentAny = false;
    let retryAny = false;
    for (const device of devices) {
      const result = await push.send(device, { title, body: text, url: path });
      if (result.ok) sentAny = true;
      else if (result.gone) await prisma.pushSubscription.deleteMany({ where: { id: device.id } });
      else if (result.retry) retryAny = true;
    }
    if (sentAny) {
      await finish(delivery.id, "SENT", now);
      report.sent += 1;
    } else if (retryAny) {
      report[await retryOrFail(delivery, "providerUnavailable", true, now)] += 1;
    } else if ((await prisma.pushSubscription.count({ where: { userId: delivery.userId } })) === 0) {
      await finish(delivery.id, "SKIPPED", now);
      report.skipped += 1;
    } else {
      await finish(delivery.id, "FAILED", now, "providerRejected");
      report.failed += 1;
    }
  }
  return report;
}

// -------------------------------------------------------------------------------------------- preferences

/** The employee's own choices for each kind, with Admin's marks, and how many devices can be pushed to. */
export async function getPreferences(actor: Actor): Promise<NotificationPreferences> {
  const [preferences, settings, pushDevices] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: actor.id } }),
    prisma.staffNotificationSetting.findMany(),
    prisma.pushSubscription.count({ where: { userId: actor.id } }),
  ]);
  return {
    items: EXTERNAL_NOTIFICATION_KINDS.map((kind) => {
      const choice = preferences.find((preference) => preference.kind === kind) ?? DEFAULT_CHOICE;
      const mark = settings.find((setting) => setting.kind === kind);
      return {
        kind,
        email: choice.email,
        push: choice.push,
        emailMandatory: mark?.emailMandatory ?? false,
        pushMandatory: mark?.pushMandatory ?? false,
      };
    }),
    pushDevices,
  };
}

/** Saves the employee's choices; a kind left out keeps its choice. A mandatory channel can be switched off but still goes out. */
export async function savePreferences(actor: Actor, rawInput: unknown): Promise<NotificationPreferences> {
  const { items } = parseInput(notificationPreferencesInputSchema, rawInput);
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.notificationPreference.upsert({
        where: { userId_kind: { userId: actor.id, kind: item.kind } },
        create: { userId: actor.id, ...item },
        update: { email: item.email, push: item.push },
      });
    }
  });
  return getPreferences(actor);
}

// ------------------------------------------------------------------------------------------------- settings

/** Admin's mandatory marks (D-053). */
export async function getSettings(actor: Actor): Promise<NotificationSettings> {
  assertCan(actor, "config.manage");
  const settings = await prisma.staffNotificationSetting.findMany();
  return {
    items: EXTERNAL_NOTIFICATION_KINDS.map((kind) => {
      const mark = settings.find((setting) => setting.kind === kind);
      return { kind, emailMandatory: mark?.emailMandatory ?? false, pushMandatory: mark?.pushMandatory ?? false };
    }),
  };
}

export async function saveSettings(actor: Actor, rawInput: unknown): Promise<NotificationSettings> {
  assertCan(actor, "config.manage");
  const { items } = parseInput(notificationSettingsInputSchema, rawInput);
  await prisma.$transaction(async (tx) => {
    const before = await tx.staffNotificationSetting.findMany();
    for (const item of items) {
      await tx.staffNotificationSetting.upsert({
        where: { kind: item.kind },
        create: { ...item, updatedById: actor.id, updatedAt: new Date() },
        update: {
          emailMandatory: item.emailMandatory,
          pushMandatory: item.pushMandatory,
          updatedById: actor.id,
          updatedAt: new Date(),
        },
      });
    }
    const after = await tx.staffNotificationSetting.findMany();
    const marks = (rows: typeof before) =>
      Object.fromEntries(rows.map((row) => [row.kind, { email: row.emailMandatory, push: row.pushMandatory }]));
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: actor.id,
      action: "notification_settings.updated",
      before: marks(before),
      after: marks(after),
    });
  });
  return getSettings(actor);
}

// ------------------------------------------------------------------------------------------------------ push

export function pushKey(): { publicKey: string } {
  return { publicKey: pushPublicKey() };
}

/** Remembers a device of the signed-in employee; the same device again only updates its keys and owner. */
export async function saveSubscription(actor: Actor, rawInput: unknown, userAgent: string | undefined): Promise<void> {
  const { endpoint, keys } = parseInput(pushSubscriptionInputSchema, rawInput);
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: actor.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent?.slice(0, 300) },
    // A phone passed to another employee keeps one subscription, now theirs.
    update: { userId: actor.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent?.slice(0, 300) },
  });
}

/** Forgets a device of the signed-in employee; another's device is not theirs to remove. */
export async function removeSubscription(actor: Actor, rawInput: unknown): Promise<void> {
  const { endpoint } = parseInput(pushRemoveInputSchema, rawInput);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: actor.id } });
}
