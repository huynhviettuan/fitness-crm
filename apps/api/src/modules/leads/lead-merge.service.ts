import { z } from "zod";
import { fillEmptyFields, mergeInputSchema, planMerge, type MergeResult } from "@flow/shared/leads";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { hasBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import { leadsVisibleTo } from "../customers/person.service.js";
import { visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import * as leads from "./lead.repository.js";
import * as repo from "./merge.repository.js";

// Merging two records of one person (BR-202, D-019, A-064..A-067). One person, one record:
// the survivor keeps its codes and gains what the other knew; the other goes to the trash
// with the reason, its codes reserved (D-038). Managers only (A-065); audited (T-048).

type Row = NonNullable<Awaited<ReturnType<typeof repo.findForMerge>>>;

/** Fields shown in the audit and the trash, never the encrypted ones (D-042). */
const SNAPSHOT_FIELDS = [
  "fullName",
  "phone",
  "email",
  "gender",
  "dateOfBirth",
  "leadCode",
  "customerCode",
  "stage",
  "leadStatus",
  "branchId",
  "picUserId",
  "channelId",
  "channelNote",
  "sourceId",
  "sourceNote",
  "needGroupId",
  "needGroupNote",
  "needDetailId",
  "needDetail",
  "notes",
  "appointmentAt",
  "contactAgainOn",
  "createdAt",
] as const satisfies readonly (keyof Row)[];

/**
 * Merges `mergedId` and the record `id` (A-064): the customer survives, or of two leads
 * the older one; two customers are refused (OQ-033). Both are locked in id order, so a
 * repeated or concurrent merge of the pair acts once and the other finds it merged.
 */
export async function mergePersons(
  actor: Actor,
  id: string,
  input: unknown,
  now: Date = new Date(),
): Promise<MergeResult> {
  assertCan(actor, "lead.merge");
  const data = parseInput(mergeInputSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  if (id === data.mergedId) throw new AppError("VALIDATION_FAILED", { fieldErrors: { mergedId: ["invalidChoice"] } });

  return prisma.$transaction(async (tx) => {
    await repo.lockPair(tx, [id, data.mergedId]);
    const a = await loadVisible(tx, actor, id);
    const b = await loadVisible(tx, actor, data.mergedId);
    const plan = planMerge(a, b);
    if (!plan.ok) throw new AppError("MERGE_CUSTOMERS_UNSUPPORTED");
    const survivor = plan.survivorId === a.id ? a : b;
    const merged = plan.mergedId === a.id ? a : b;
    // A merged record is a lead: contracts and bookings never move (A-067).
    if (merged.stage !== "LEAD" || merged._count.contracts > 0 || merged._count.bookings > 0) {
      throw new AppError("MERGE_CUSTOMERS_UNSUPPORTED");
    }
    const reason = await resolveChoice(tx, "deleteReasons", "reasonId", {
      optionId: data.reasonId,
      note: data.reasonNote,
    });

    const { fill, conflicts } = fillEmptyFields(survivor, merged);
    const snapshot = snapshotOf(merged);
    await repo.markMerged(tx, merged.id, survivor.id, now);
    const filled = Object.keys(fill).length > 0 ? await repo.fillSurvivor(tx, survivor.id, fill) : survivor;
    const moved = await repo.moveChildren(tx, merged.id, survivor, actor.id, now);
    await repo.addMerge(tx, {
      survivorId: survivor.id,
      mergedId: merged.id,
      reasonId: reason.optionId,
      reasonNote: reason.note,
      mergedById: actor.id,
      before: {
        ...snapshot,
        conflicts: Object.fromEntries(conflicts.map((field) => [field, merged[field]])),
        filled: Object.keys(fill),
        moved,
      } as Prisma.InputJsonValue,
    });
    await moveToTrash(
      tx,
      actor,
      {
        entityType: "person",
        entityId: merged.id,
        branchId: merged.branchId,
        title: `${merged.leadCode ?? ""} · ${merged.fullName}`,
        amount: null,
        snapshot: { ...snapshot, mergedInto: survivor.id },
      },
      reason,
      now,
    );
    // D-042: encrypted fields are listed as filled, never with their values.
    const shown = Object.keys(fill).filter((field) => !ENCRYPTED.includes(field));
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "person",
      entityId: survivor.id,
      action: "person.merged",
      before: Object.fromEntries(
        shown.map((field) => [field, jsonValue((survivor as Record<string, unknown>)[field])]),
      ),
      after: Object.fromEntries(shown.map((field) => [field, jsonValue((filled as Record<string, unknown>)[field])])),
      context: {
        mergedId: merged.id,
        mergedLeadCode: merged.leadCode,
        conflicts,
        filled: Object.keys(fill),
        reason: { optionId: reason.optionId, note: reason.note },
      },
    });
    const code = (survivor.stage === "LEAD" ? survivor.leadCode : survivor.customerCode) ?? "";
    const managers = await leads.leadManagers(tx, survivor.branchId);
    await notify(
      tx,
      [survivor.picUserId, ...managers].filter((userId) => userId !== actor.id),
      {
        kind: "personMerged",
        params: { mergedCode: merged.leadCode ?? "", code, name: survivor.fullName },
        link: survivor.stage === "LEAD" ? `/leads/${survivor.id}` : `/customers/${survivor.id}`,
      },
    );
    return { survivorId: survivor.id, mergedId: merged.id, stage: survivor.stage };
  }, LOCKING_TRANSACTION);
}

const ENCRYPTED: string[] = ["idDocumentNumber", "healthNote", "dataConsentAt", "dataConsentById", "idDocumentType"];

/**
 * A record the actor may merge: in their branches and, for a lead, in their lead scope; for a
 * customer, in their customer scope with `customer.view` (A-068). Not visible: NOT_FOUND;
 * visible but already merged into another: PERSON_ALREADY_MERGED. Called with the pair locked.
 */
async function loadVisible(db: Db, actor: Actor, id: string): Promise<Row> {
  const row = await repo.findForMerge(db, id);
  if (!row || !hasBranch(actor, row.branchId)) throw new AppError("NOT_FOUND");
  if (row.mergedIntoId) throw new AppError("PERSON_ALREADY_MERGED");
  const visibility =
    row.stage === "LEAD"
      ? leadsVisibleTo(actor)
      : actor.permissions.has("customer.view")
        ? customersVisibleTo(actor)
        : { id: { in: [] } };
  if ((await db.customer.count({ where: { AND: [{ id }, visibility] } })) === 0) throw new AppError("NOT_FOUND");
  return row;
}

function snapshotOf(row: Row): Record<string, unknown> {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, jsonValue(row[field])]));
}

function jsonValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}
