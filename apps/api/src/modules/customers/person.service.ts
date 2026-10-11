import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import type { Actor } from "../../platform/auth/session.js";

// One person, one record (D-019): a lead and a customer are the same row of `customers`,
// told apart by their stage. These rules apply to both.

/** Which leads an actor may see: their branches, and with "own" scope those they added or are in charge of. */
export function leadsVisibleTo(actor: Actor): Prisma.CustomerWhereInput {
  const own: Prisma.CustomerWhereInput = { OR: [{ createdById: actor.id }, { picUserId: actor.id }] };
  return { AND: [{ stage: "LEAD" }, inBranches(actor), isOwnOnly(actor, "leads") ? own : {}] };
}

/**
 * D-019: a phone belongs to one person. A second lead or customer with it is refused,
 * naming the existing record when the actor may see it, so they open it instead (the
 * merge arrives in M2 slice 5). Concurrent checks of one number wait for each other.
 */
export async function assertPhoneFree(
  db: Db,
  actor: Actor,
  phone: string | null | undefined,
  exceptId: string | null,
  visibleCustomers: (actor: Actor) => Prisma.CustomerWhereInput,
): Promise<void> {
  if (!phone) return;
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone:${phone}`}))::text AS locked`;
  const existing = await db.customer.findFirst({
    where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, stage: true, leadCode: true, customerCode: true, fullName: true },
  });
  if (!existing) return;
  const visibility = existing.stage === "LEAD" ? leadsVisibleTo(actor) : visibleCustomers(actor);
  const visible = (await db.customer.count({ where: { AND: [{ id: existing.id }, visibility] } })) === 1;
  throw new AppError("PHONE_ALREADY_USED", {
    fieldErrors: { phone: ["phoneAlreadyUsed"] },
    duplicate: visible
      ? {
          id: existing.id,
          stage: existing.stage,
          code: (existing.stage === "LEAD" ? existing.leadCode : existing.customerCode) ?? "",
          fullName: existing.fullName,
        }
      : undefined,
  });
}

/** How records show the customer they belong to; a customer always has a code (check customers_stage_codes). */
export function customerRef(customer: { id: string; customerCode: string | null; fullName: string }) {
  return { id: customer.id, customerCode: customer.customerCode ?? "", fullName: customer.fullName };
}
