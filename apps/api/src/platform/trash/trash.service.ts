import { listTrashSchema, type TrashEntityType, type TrashEntry } from "@gymcrm/shared/trash";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { prisma, type Db } from "../db/prisma.js";
import { chosen, chosenSelect } from "../options/option.service.js";
import { assertCan } from "../permissions/assert.js";
import { inBranches, isMasked } from "../permissions/scope.js";
import { parseInput } from "../validation/parse.js";
import { gymDaysRange } from "../time/gym-days.js";

// The trash (D-035, T-047, FR-TRASH). A deleted record keeps its row, marked deleted,
// and gets one entry here with its last shape, who deleted it, when, and why. Nothing
// in the application changes or removes an entry.

export type TrashItem = {
  entityType: TrashEntityType;
  entityId: string;
  branchId: string;
  /** A short name for lists, e.g. "HD000012 · Nguyễn Văn An". */
  title: string;
  amount: number | null;
  /** The record as the API showed it, already encoded as JSON. */
  snapshot: Record<string, unknown>;
};

/**
 * Called by a service that has just marked a record deleted, in the same transaction:
 * writes the trash entry and the audit event with the record as it was (T-048).
 */
export async function moveToTrash(
  db: Db,
  actor: Pick<Actor, "id">,
  item: TrashItem,
  reason: { optionId: string; note: string | null },
  deletedAt: Date,
): Promise<void> {
  await db.trashEntry.create({
    data: {
      entityType: item.entityType,
      entityId: item.entityId,
      branchId: item.branchId,
      title: item.title,
      amount: item.amount,
      snapshot: item.snapshot as Prisma.InputJsonValue,
      reasonId: reason.optionId,
      reasonNote: reason.note,
      deletedById: actor.id,
      deletedAt,
    },
  });
  await recordAudit(db, {
    actorUserId: actor.id,
    entityType: item.entityType,
    entityId: item.entityId,
    action: `${item.entityType}.deleted`,
    before: item.snapshot,
    context: { reason: { optionId: reason.optionId, note: reason.note } },
  });
}

const entryInclude = {
  branch: { select: { id: true, name: true } },
  reason: { select: chosenSelect },
  deletedBy: { select: { name: true } },
} as const satisfies Prisma.TrashEntryInclude;

/** Newest first, in the viewer's branches (FR-TRASH-002). */
export async function listTrash(
  actor: Actor,
  rawQuery: unknown,
): Promise<{ items: TrashEntry[]; total: number; page: number; pageSize: number }> {
  assertCan(actor, "trash.view");
  const query = parseInput(listTrashSchema, rawQuery);
  const where: Prisma.TrashEntryWhereInput = {
    AND: [
      inBranches(actor),
      {
        entityType: query.entityType,
        deletedAt: gymDaysRange(query.from, query.to),
      },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.trashEntry.findMany({
      where,
      include: entryInclude,
      orderBy: { deletedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.trashEntry.count({ where }),
  ]);
  // Amounts of receipts and vouchers hidden from the role stay hidden here (D-017).
  const hideAmounts = isMasked(actor, "receipts.totals");
  const items = rows.map((row) => ({
    id: row.id,
    entityType: row.entityType as TrashEntityType,
    entityId: row.entityId,
    branch: row.branch,
    title: row.title,
    amount: hideAmounts || row.amount === null ? null : Number(row.amount),
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy.name,
    reason: chosen(row.reason, row.reasonNote),
    snapshot: hideAmounts ? withoutAmount(row.snapshot) : (row.snapshot as Record<string, unknown>),
  }));
  return { items, total, page: query.page, pageSize: query.pageSize };
}

function withoutAmount(snapshot: Prisma.JsonValue): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot as Record<string, unknown>).filter(([key]) => key !== "amount"));
}
