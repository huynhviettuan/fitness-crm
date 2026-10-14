import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import {
  isOptionList,
  listOptionsQuerySchema,
  optionInputSchema,
  optionOrderSchema,
  type ChosenOption,
  type Option,
  type OptionListKey,
  type OtherNote,
} from "@flow/shared/options";
import { diffFields, recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { isUniqueViolation } from "../db/errors.js";
import { prisma, type Db } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { assertCan } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";

// FR-PLT-005, D-016. Options are never deleted: an inactive option can no longer be
// chosen, and the records that have it keep it. Each list has one "Khác", always
// active and always listed last, which needs a note wherever it is chosen.

const optionSelect = {
  id: true,
  listKey: true,
  labelVi: true,
  labelEn: true,
  code: true,
  sortOrder: true,
  active: true,
  isOther: true,
} as const;
const listOrder: Prisma.OptionOrderByWithRelationInput[] = [
  { isOther: "asc" },
  { sortOrder: "asc" },
  { labelVi: "asc" },
];

/** How records include the option they chose, for `chosen()`. */
export const chosenSelect = { id: true, labelVi: true, labelEn: true, code: true, isOther: true } as const;

/** An option as a record shows it, with the note written with it. */
export function chosen(option: Omit<ChosenOption, "note">, note: string | null): ChosenOption {
  return { ...option, note };
}

/** Any signed-in user: forms need the lists. */
export async function listOptions(rawKey: string, rawQuery: unknown): Promise<Option[]> {
  const listKey = listKeyOf(rawKey);
  const { includeInactive } = parseInput(listOptionsQuerySchema, rawQuery);
  const options = await prisma.option.findMany({
    where: { listKey, ...(includeInactive ? {} : { active: true }) },
    select: optionSelect,
    orderBy: listOrder,
  });
  return options as Option[];
}

export async function createOption(actor: Actor, rawKey: string, input: unknown): Promise<Option> {
  assertCan(actor, "config.manage");
  const listKey = listKeyOf(rawKey);
  const data = parseInput(optionInputSchema, input);
  return withLabelConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      await assertLabelFree(tx, listKey, data.labelVi, null, data.code);
      const last = await tx.option.aggregate({ where: { listKey, isOther: false }, _max: { sortOrder: true } });
      const option = await tx.option.create({
        data: { ...data, listKey, sortOrder: (last._max.sortOrder ?? 0) + 1 },
        select: optionSelect,
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "option",
        entityId: option.id,
        action: "option.created",
        after: option,
      });
      return option as Option;
    }),
  );
}

/** All fields are sent. Deactivating keeps the option on the records that have it. */
export async function updateOption(actor: Actor, rawKey: string, id: string, input: unknown): Promise<Option> {
  assertCan(actor, "config.manage");
  const listKey = listKeyOf(rawKey);
  const data = parseInput(optionInputSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return withLabelConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.option.findFirst({ where: { id, listKey }, select: optionSelect });
      if (!before) throw new AppError("NOT_FOUND");
      if (before.isOther && !data.active)
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { active: ["otherAlwaysActive"] } });
      await assertLabelFree(tx, listKey, data.labelVi, id, data.code);
      const after = await tx.option.update({ where: { id }, data, select: optionSelect });
      const changes = diffFields(before, after, ["labelVi", "labelEn", "code", "active"]);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "option",
          entityId: id,
          action: "option.updated",
          ...changes,
        });
      }
      return after as Option;
    }),
  );
}

/** Sets the order of every option but "Khác", which stays last. */
export async function reorderOptions(actor: Actor, rawKey: string, input: unknown): Promise<Option[]> {
  assertCan(actor, "config.manage");
  const listKey = listKeyOf(rawKey);
  const { optionIds } = parseInput(optionOrderSchema, input);
  await prisma.$transaction(async (tx) => {
    const options = await tx.option.findMany({
      where: { listKey, isOther: false },
      select: { id: true, sortOrder: true },
    });
    const sameSet =
      optionIds.length === options.length &&
      new Set(optionIds).size === options.length &&
      options.every((o) => optionIds.includes(o.id));
    if (!sameSet) throw new AppError("VALIDATION_FAILED", { fieldErrors: { optionIds: ["invalidChoice"] } });
    for (const [index, id] of optionIds.entries()) {
      const from = options.find((o) => o.id === id)!.sortOrder;
      if (from === index + 1) continue;
      await tx.option.update({ where: { id }, data: { sortOrder: index + 1 } });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "option",
        entityId: id,
        action: "option.reordered",
        before: { sortOrder: from },
        after: { sortOrder: index + 1 },
      });
    }
  });
  return listOptions(listKey, { includeInactive: true });
}

/**
 * The notes written with "Khác" on a list, grouped and most used first, so admin can
 * turn frequent ones into real options (FR-PLT-005).
 */
export async function otherNotes(actor: Actor, rawKey: string): Promise<OtherNote[]> {
  assertCan(actor, "config.manage");
  const listKey = listKeyOf(rawKey);
  const other = await prisma.option.findFirst({ where: { listKey, isOther: true }, select: { id: true } });
  if (!other) return [];
  const id = other.id;
  const sources: Record<OptionListKey, Prisma.Sql> = {
    paymentMethods: Prisma.sql`SELECT "method_note" AS note, "created_at" AS at FROM "payments" WHERE "method_option_id" = ${id}::uuid`,
    incomeCategories: Prisma.sql`SELECT "category_note" AS note, "created_at" AS at FROM "cash_transactions" WHERE "category_option_id" = ${id}::uuid`,
    expenseTypes: Prisma.sql`SELECT "category_note" AS note, "created_at" AS at FROM "cash_transactions" WHERE "category_option_id" = ${id}::uuid`,
    // Every deletion, whatever the record, is in the trash with its reason (D-035).
    deleteReasons: Prisma.sql`SELECT "reason_note" AS note, "deleted_at" AS at FROM "trash_entries" WHERE "reason_option_id" = ${id}::uuid`,
    rejectReasons: Prisma.sql`SELECT "reject_reason_note" AS note, "decided_at" AS at FROM "approval_requests" WHERE "reject_reason_option_id" = ${id}::uuid`,
    departments: Prisma.sql`SELECT "department_note" AS note, "updated_at" AS at FROM "employees" WHERE "department_option_id" = ${id}::uuid`,
    jobTitles: Prisma.sql`SELECT "title_note" AS note, "updated_at" AS at FROM "employees" WHERE "title_option_id" = ${id}::uuid`,
    leadChannels: Prisma.sql`SELECT "channel_note" AS note, "created_at" AS at FROM "customers" WHERE "channel_option_id" = ${id}::uuid
      UNION ALL SELECT "channel_note", "created_at" FROM "lead_inquiries" WHERE "channel_option_id" = ${id}::uuid`,
    leadSources: Prisma.sql`SELECT "source_note" AS note, "created_at" AS at FROM "customers" WHERE "source_option_id" = ${id}::uuid
      UNION ALL SELECT "source_note", "created_at" FROM "lead_inquiries" WHERE "source_option_id" = ${id}::uuid`,
    needGroups: Prisma.sql`SELECT "need_group_note" AS note, "created_at" AS at FROM "customers" WHERE "need_group_option_id" = ${id}::uuid
      UNION ALL SELECT "need_group_note", "created_at" FROM "lead_inquiries" WHERE "need_group_option_id" = ${id}::uuid`,
    painStatuses: Prisma.sql`SELECT "pain_status_note" AS note, "created_at" AS at FROM "customers" WHERE "pain_status_option_id" = ${id}::uuid`,
    assessmentTypes: Prisma.sql`SELECT "assessment_type_note" AS note, "created_at" AS at FROM "customers" WHERE "assessment_type_option_id" = ${id}::uuid`,
    // Every refusal, also of leads that came back since (D-020).
    leadRefuseReasons: Prisma.sql`SELECT "reason_note" AS note, "changed_at" AS at FROM "lead_status_changes" WHERE "reason_option_id" = ${id}::uuid`,
    auditFailReasons: Prisma.sql`SELECT a."comment" AS note, a."created_at" AS at FROM "consulting_audit_criteria" c JOIN "consulting_audits" a ON a."id" = c."audit_id" WHERE c."option_id" = ${id}::uuid`,
    needDetails: Prisma.sql`SELECT "need_detail" AS note, "updated_at" AS at FROM "customers" WHERE "need_detail_option_id" = ${id}::uuid`,
    // The note of a removed tick is in its history entry, with the reason's name (D-054).
    stepReopenReasons: Prisma.sql`SELECT "metadata"->>'note' AS note, "created_at" AS at FROM "audit_events" WHERE "action" = 'lead.step_reopened' AND "metadata"->>'reason' = (SELECT "label_vi" FROM "options" WHERE "id" = ${id}::uuid)`,
    customerGroups: Prisma.sql`SELECT "customer_group_note" AS note, "updated_at" AS at FROM "customers" WHERE "customer_group_option_id" = ${id}::uuid`,
    exceptionPriceReasons: Prisma.sql`SELECT "exception_note" AS note, "created_at" AS at FROM "contracts" WHERE "exception_reason_option_id" = ${id}::uuid`,
    // The notes of a deactivation and of its end are on the freeze (D-023).
    freezeReasons: Prisma.sql`SELECT "reason_note" AS note, "frozen_at" AS at FROM "contract_freezes" WHERE "reason_option_id" = ${id}::uuid`,
    unfreezeReasons: Prisma.sql`SELECT "end_reason_note" AS note, "ended_at" AS at FROM "contract_freezes" WHERE "end_reason_option_id" = ${id}::uuid`,
    burnShowReasons: Prisma.sql`SELECT "added_reason_note" AS note, "created_at" AS at FROM "bookings" WHERE "added_reason_option_id" = ${id}::uuid`,
    // The log's own lists are used from M7.3, which names where their notes are kept; until then none are written.
    workoutFlags: Prisma.sql`SELECT NULL::text AS note, NULL::timestamptz AS at WHERE false`,
    workoutActions: Prisma.sql`SELECT NULL::text AS note, NULL::timestamptz AS at WHERE false`,
    sessionImpacts: Prisma.sql`SELECT NULL::text AS note, NULL::timestamptz AS at WHERE false`,
    sessionSummaries: Prisma.sql`SELECT NULL::text AS note, NULL::timestamptz AS at WHERE false`,
    // The note of a cancellation is on its change voucher (A-240).
    cancelReasons: Prisma.sql`SELECT "reason_note" AS note, "created_at" AS at FROM "contract_change_vouchers" WHERE "reason_option_id" = ${id}::uuid`,
    // The note of an unapproval is in its history entry (A-124).
    unapproveReasons: Prisma.sql`SELECT "metadata"->>'note' AS note, "created_at" AS at FROM "audit_events" WHERE "action" = 'contract.unapproved' AND "metadata"->>'reason' = (SELECT "label_vi" FROM "options" WHERE "id" = ${id}::uuid)`,
  };
  const rows = await prisma.$queryRaw<{ note: string; count: number; lastUsedAt: Date }[]>`
    SELECT MIN(btrim(note)) AS note, COUNT(*)::int AS count, MAX(at) AS "lastUsedAt"
    FROM (${sources[listKey]}) AS used
    WHERE note IS NOT NULL
    GROUP BY lower(btrim(note))
    ORDER BY count DESC, "lastUsedAt" DESC
    LIMIT 100`;
  return rows.map((row) => ({ ...row, lastUsedAt: row.lastUsedAt.toISOString() }));
}

/**
 * Checks an option chosen in a form (D-016): it belongs to the list and is active —
 * or is the record's current option — and "Khác" comes with a note. Errors name the
 * form field (`methodId`) and its note field (`methodNote`).
 */
export async function resolveChoice(
  db: Db,
  listKey: OptionListKey,
  field: string,
  choice: { optionId: string; note: string | null },
  current: string | null = null,
  /** The form field of the note when it is not `<field>Note`. */
  noteField: string = field.replace(/Id$/, "Note"),
): Promise<{ optionId: string; note: string | null }> {
  const option = await db.option.findFirst({
    where: { id: choice.optionId, listKey },
    select: { id: true, active: true, isOther: true },
  });
  if (!option || (!option.active && option.id !== current)) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: ["invalidChoice"] } });
  }
  if (option.isOther && !choice.note) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { [noteField]: ["otherNeedsNote"] } });
  }
  return { optionId: option.id, note: choice.note };
}

function listKeyOf(raw: string): OptionListKey {
  if (!isOptionList(raw)) throw new AppError("NOT_FOUND");
  return raw;
}

/** Labels are unique in a list whatever their case. */
async function assertLabelFree(
  db: Db,
  listKey: OptionListKey,
  labelVi: string,
  exceptId: string | null,
  code: string | null = null,
): Promise<void> {
  if (code) {
    const same = await db.option.findFirst({
      where: { listKey, code: { equals: code, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (same) throw new AppError("VALIDATION_FAILED", { fieldErrors: { code: ["codeAlreadyUsed"] } });
  }
  const clash = await db.option.findFirst({
    where: {
      listKey,
      labelVi: { equals: labelVi, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new AppError("VALIDATION_FAILED", { fieldErrors: { labelVi: ["nameAlreadyUsed"] } });
}

async function withLabelConflictsMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { labelVi: ["nameAlreadyUsed"] } });
    throw error;
  }
}
