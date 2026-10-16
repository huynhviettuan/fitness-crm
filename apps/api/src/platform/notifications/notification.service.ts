import { z } from "zod";
import {
  NOTIFICATION_KINDS,
  listNotificationsSchema,
  type Notification as NotificationView,
  type NotificationKind,
  type NotificationParams,
} from "@gymcrm/shared/notifications";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../auth/session.js";
import { prisma, type Db } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { parseInput } from "../validation/parse.js";
import { scheduleDeliveries } from "./delivery.service.js";

// In-app notifications (FR-PLT-009). Written in the transaction of what caused them, so
// nobody is told about a change that was rolled back. Each user sees only their own.

export type NewNotification = { kind: NotificationKind; params: NotificationParams; link: string | null };

/** One notification for each user named once; nothing when nobody is left. */
export async function notify(
  db: Db,
  userIds: Iterable<string | null | undefined>,
  notification: NewNotification,
): Promise<void> {
  const ids = [...new Set([...userIds].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const created = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({
      userId,
      kind: notification.kind,
      params: notification.params,
      link: notification.link,
    })),
    select: { id: true, userId: true, kind: true },
  });
  // The important ones also go out by email and to the phone, as each employee chose (D-053, M6.4).
  await scheduleDeliveries(db, created);
}

/** Active users who work in the branch: every-branch users, and those granted it (D-014). */
export function activeInBranch(branchId: string): Prisma.UserWhereInput {
  return { status: "ACTIVE", OR: [{ allBranches: true }, { branches: { some: { branchId } } }] };
}

export async function listNotifications(actor: Actor, rawQuery: unknown) {
  const query = parseInput(listNotificationsSchema, rawQuery);
  const where: Prisma.NotificationWhereInput = { userId: actor.id, ...(query.unreadOnly ? { readAt: null } : {}) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { items: items.map(toView), total, page: query.page, pageSize: query.pageSize };
}

export async function notificationSummary(actor: Actor): Promise<{ unread: number }> {
  return { unread: await prisma.notification.count({ where: { userId: actor.id, readAt: null } }) };
}

/** Someone else's notification is not found. Reading one twice keeps the first time. */
export async function markRead(actor: Actor, id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const exists = await prisma.notification.count({ where: { id, userId: actor.id } });
  if (exists === 0) throw new AppError("NOT_FOUND");
  await prisma.notification.updateMany({ where: { id, userId: actor.id, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllRead(actor: Actor): Promise<void> {
  await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
}

function toView(row: {
  id: string;
  kind: string;
  params: Prisma.JsonValue;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  const params = row.params && typeof row.params === "object" && !Array.isArray(row.params) ? row.params : {};
  return {
    id: row.id,
    // A kind no longer in the code would fail the response schema; such rows are not written.
    kind: (NOTIFICATION_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as NotificationKind)
      : "taskCommented",
    params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    link: row.link,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
