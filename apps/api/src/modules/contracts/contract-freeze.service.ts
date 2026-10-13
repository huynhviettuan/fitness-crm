import { z } from "zod";
import {
  canDeactivate,
  canReactivate,
  deactivateSchema,
  effectiveStatus,
  endDateAfterFreeze,
  frozenDaysBetween,
  reactivateSchema,
  type Contract as ContractView,
} from "@flow/shared/contracts";
import type { Actor } from "../../platform/auth/session.js";
import { LOCKING_TRANSACTION, prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { createContractFreezeTask } from "../tasks/task.service.js";
import * as repo from "./contract.repository.js";
import { getOrThrow, gymToday, presentOne } from "./contract.service.js";

// Deactivating (Tạm vô hiệu) and reactivating a contract (D-023, brief §5.5, AC-14). A frozen contract is not booked,
// checked in, or completed, and does not expire; each freeze is its own record and extends the end date at most once,
// when it ends. Both run under the contract lock (T-036, T-040).

/** A temporary lock for review, with a reason. Repeating it on a contract already frozen returns its state. */
export async function deactivateContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.deactivate");
  const { reasonId, reasonNote } = parseInput(deactivateSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockContract(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    if (before.status === "FROZEN") return presentOne(tx, before, today, actor);
    if (!canDeactivate(effectiveStatus(before, today))) throw new AppError("INVALID_STATUS_TRANSITION");
    const reason = await resolveChoice(tx, "freezeReasons", "reasonId", { optionId: reasonId, note: reasonNote });
    const started = await repo.deactivate(tx, id, {
      frozenOn: today,
      frozenById: actor.id,
      reasonId: reason.optionId,
      reasonNote: reason.note,
    });
    if (!started) throw new AppError("INVALID_STATUS_TRANSITION");
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "contract",
      entityId: id,
      action: "contract.deactivated",
      before: { status: "ACTIVE" },
      after: { status: "FROZEN" },
      context: { reason: { optionId: reason.optionId, note: reason.note } },
    });
    return presentOne(tx, await getOrThrow(tx, actor, id), today, actor);
  }, LOCKING_TRANSACTION);
}

/**
 * Ends the freeze with a reason and the admin's choice about the frozen days: add them all, add a number, or none
 * (D-023). The end date changes only here, once; a second request finds the contract already active and changes nothing.
 */
export async function reactivateContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.reactivate");
  const data = parseInput(reactivateSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockContract(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    if (!canReactivate(before.status)) {
      // Another request reactivated it first: the contract is as they left it.
      if (before.status === "ACTIVE") return presentOne(tx, before, today, actor);
      throw new AppError("INVALID_STATUS_TRANSITION");
    }
    const open = await repo.findOpenFreeze(tx, id);
    if (!open) throw new AppError("INVALID_STATUS_TRANSITION");
    const reason = await resolveChoice(tx, "unfreezeReasons", "reasonId", {
      optionId: data.reasonId,
      note: data.reasonNote,
    });

    const frozenDays = frozenDaysBetween(open.frozenOn, today);
    const addedDays = data.extension === "ALL" ? frozenDays : data.extension === "CUSTOM" ? (data.days ?? 0) : 0;
    const newEndDate = endDateAfterFreeze(before.endDate, addedDays);
    const done = await repo.reactivate(tx, id, {
      freezeId: open.id,
      endedOn: today,
      endedById: actor.id,
      endReasonId: reason.optionId,
      endReasonNote: reason.note,
      frozenDays,
      addedDays,
      previousEndDate: before.endDate,
      newEndDate,
    });
    if (!done) throw new AppError("INVALID_STATUS_TRANSITION");
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "contract",
      entityId: id,
      action: "contract.reactivated",
      before: { status: "FROZEN", endDate: before.endDate.toISOString().slice(0, 10) },
      after: { status: "ACTIVE", endDate: newEndDate.toISOString().slice(0, 10) },
      context: {
        reason: { optionId: reason.optionId, note: reason.note },
        frozenDays,
        addedDays,
        extension: data.extension,
      },
    });
    return presentOne(tx, await getOrThrow(tx, actor, id), today, actor);
  }, LOCKING_TRANSACTION);
}

/**
 * A contract frozen for more than `freezeReminderDays` reminds the manager, once (D-023, brief §5.5): everyone who may
 * reactivate it in its branch is told, and a task goes to the manager department when the parameter names one. Run by
 * the worker (T-059); the freeze remembers it was reminded, so a second run sends nothing.
 */
export async function remindLongFreezes(now: Date = new Date()): Promise<number> {
  const days = Number(await readParameter(prisma, "freezeReminderDays"));
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string; contract_id: string; frozen_by: string }[]>`
      UPDATE contract_freezes SET reminded_at = ${now}
      WHERE ended_at IS NULL AND reminded_at IS NULL AND frozen_at <= ${cutoff}
      RETURNING id, contract_id, frozen_by`;
    for (const freeze of due) {
      const contract = await tx.contract.findUnique({
        where: { id: freeze.contract_id },
        select: { id: true, contractCode: true, branchId: true, customer: { select: { fullName: true } } },
      });
      if (!contract) continue;
      const managers = await tx.user.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ allBranches: true }, { branches: { some: { branchId: contract.branchId } } }],
          role: { permissions: { some: { permission: "contract.reactivate" } } },
        },
        select: { id: true },
      });
      await notify(
        tx,
        managers.map((manager) => manager.id),
        {
          kind: "contractFrozenLong",
          params: { code: contract.contractCode, name: contract.customer.fullName, days: String(days) },
          link: `/contracts/${contract.id}`,
        },
      );
      await createContractFreezeTask(tx, {
        contract: { id: contract.id, branchId: contract.branchId, contractCode: contract.contractCode },
        customerName: contract.customer.fullName,
        by: freeze.frozen_by,
        days,
        dueAt: now,
      });
    }
    return due.length;
  });
}
