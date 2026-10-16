import { sessionStatusInputSchema, type SessionStatus, type StatusColor } from "@gymcrm/shared/bookings";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { listStatusRules, type StatusRule } from "../bookings/booking.repository.js";

// The session statuses and their rules (brief §6.2, D-025, D-029, T-050, A-145 to A-148). A rule changed here applies to
// the next status change only: every session keeps the flags of the rule applied when its status was set.

function present(rule: StatusRule): SessionStatus {
  return { ...rule, color: rule.color as StatusColor };
}

/** Every signed-in user: the calendar and the lists draw the labels and colors. */
export async function listSessionStatuses(): Promise<{ items: SessionStatus[] }> {
  return { items: (await listStatusRules(prisma)).map(present) };
}

const AUDITED = ["labelVi", "labelEn", "consumes", "creditsPt", "locksOnSet", "color"] as const;

/**
 * Admin edits a status: its labels, whether it consumes a session and credits the PT, whether it locks, and its color.
 * Booking itself never consumes or credits or locks (D-025), and the slot rule is not editable (A-024).
 */
export async function updateSessionStatus(actor: Actor, code: string, rawInput: unknown): Promise<SessionStatus> {
  assertCan(actor, "config.manage");
  const input = parseInput(sessionStatusInputSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const before = await tx.sessionStatus.findUnique({ where: { code } });
    if (!before) throw new AppError("NOT_FOUND");
    if (code === "BOOKED" && (input.consumes || input.creditsPt || input.locksOnSet)) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { consumes: ["bookedNeverConsumes"] } });
    }
    // Xóa frees the time and uses nothing, whatever the labels say (D-025).
    if (code === "DELETED" && (input.consumes || input.creditsPt || !input.locksOnSet)) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { consumes: ["bookedNeverConsumes"] } });
    }
    const after = await tx.sessionStatus.update({ where: { code }, data: input });
    const changes = diffFields(before, after, [...AUDITED]);
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "session_status",
        entityId: before.id,
        action: "session_status.updated",
        ...changes,
      });
    }
    return present(after);
  });
}
