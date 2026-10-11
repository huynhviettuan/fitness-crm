import { showInputSchema, type Lead, type ShowData } from "@flow/shared/leads";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { seal } from "../../platform/security/sensitive.js";
import { assertPhoneFree } from "../customers/person.service.js";
import { visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import { nextCustomerCode } from "../customers/customer.repository.js";
import * as repo from "./lead.repository.js";
import { lockedLead, present } from "./lead.present.js";
import { applyJourneyEvent, finishOutcomeStep } from "./checklist.engine.js";
import { contactAgainDay } from "./lead-journey.service.js";

// The visit (brief §3 stage 3, §4.1; D-019): the lead showed and becomes a customer in
// the same record, or did not and goes to re-care. Recorded from the lead's buttons or
// from the checklist step whose result carries the outcome; both end here. Daily work,
// so no approval (OQ-029 interim); audited, never with the ID number or health note.

type FromStep = { stepId?: string; note?: string | null };

/** The lead showed: it becomes a customer with a customer code (D-019, BR-206). */
export async function showLead(
  actor: Actor,
  id: string,
  input: unknown,
  now: Date = new Date(),
): Promise<{ customerId: string }> {
  assertCan(actor, "lead.manage");
  const data = parseInput(showInputSchema, input);
  return prisma.$transaction(async (tx) => {
    const lead = await lockedLead(tx, actor, id);
    await convertLead(tx, actor, lead, data, now);
    return { customerId: lead.id };
  });
}

/** The lead did not come: No show, due for re-care (BR-204). */
export async function noShowLead(actor: Actor, id: string, now: Date = new Date()): Promise<Lead> {
  assertCan(actor, "lead.manage");
  return prisma.$transaction(async (tx) => {
    const lead = await lockedLead(tx, actor, id);
    return present(actor, await recordNoShow(tx, actor, lead, now));
  });
}

/**
 * Converts a locked, visible lead (D-019): stage Customer, status Show, a customer code,
 * the ID document and health note encrypted (D-042) with the consent recorded, and the
 * phone checked to be no one else's. Any lead still in its journey can show (a walk-in
 * need not have booked first, A-061).
 */
export async function convertLead(
  db: Db,
  actor: Actor,
  lead: repo.LeadRecord,
  data: ShowData,
  now: Date,
  from: FromStep = {},
) {
  const status = lead.leadStatus ?? "NEW";
  if (status === "SHOWED" || status === "CONTRACTED") throw new AppError("INVALID_STATUS_TRANSITION");
  await assertPhoneFree(db, actor, data.phone, lead.id, customersVisibleTo);
  const customerCode = await nextCustomerCode(db);
  const after = await db.customer.update({
    where: { id: lead.id },
    data: {
      stage: "CUSTOMER",
      customerCode,
      leadStatus: "SHOWED",
      leadStatusChangedAt: now,
      contactAgainOn: null,
      phone: data.phone,
      email: data.email,
      dateOfBirth: data.birthDate,
      nationality: data.nationality,
      idDocumentType: data.idDocumentType,
      idDocumentNumber: seal(data.idDocumentNumber),
      healthNote: seal(data.healthNote),
      dataConsentAt: now,
      dataConsentById: actor.id,
    },
    select: { id: true, leadStatus: true, appointmentAt: true, contactAgainOn: true },
  });
  await repo.addStatusChange(db, {
    customerId: lead.id,
    fromStatus: status,
    toStatus: "SHOWED",
    changedById: actor.id,
    changedAt: now,
    appointmentAt: lead.appointmentAt,
    note: from.note ?? null,
  });
  await finishAndFollow(db, after, "SHOW", now, actor.id, from);
  await recordAudit(db, {
    actorUserId: actor.id,
    entityType: "lead",
    entityId: lead.id,
    action: "lead.converted",
    before: { stage: "LEAD", leadStatus: status, phone: lead.phone, email: lead.email },
    // D-042: the ID number and health note never go to the history, only that they were given.
    after: {
      stage: "CUSTOMER",
      customerCode,
      leadStatus: "SHOWED",
      phone: data.phone,
      email: data.email,
      nationality: data.nationality,
      idDocumentType: data.idDocumentType,
      idDocumentGiven: true,
      healthNoteGiven: data.healthNote !== null,
      dataConsentAt: now,
    },
  });
}

/** A booked lead did not come (brief §3 stage 3): No show, with the day to contact them again. */
export async function recordNoShow(
  db: Db,
  actor: Actor,
  lead: repo.LeadRecord,
  now: Date,
  from: FromStep = {},
): Promise<repo.LeadRecord> {
  if (lead.leadStatus !== "BOOKED") throw new AppError("INVALID_STATUS_TRANSITION");
  const contactAgainOn = await contactAgainDay(db, now);
  const after = await repo.updateJourney(db, lead.id, {
    leadStatus: "NO_SHOW",
    leadStatusChangedAt: now,
    appointmentAt: null,
    contactAgainOn,
  });
  await repo.addStatusChange(db, {
    customerId: lead.id,
    fromStatus: "BOOKED",
    toStatus: "NO_SHOW",
    changedById: actor.id,
    changedAt: now,
    appointmentAt: lead.appointmentAt,
    note: from.note ?? null,
  });
  await finishAndFollow(db, after, "NO_SHOW", now, actor.id, from);
  await recordAudit(db, {
    actorUserId: actor.id,
    entityType: "lead",
    entityId: lead.id,
    action: "lead.status_changed",
    before: { leadStatus: "BOOKED", appointmentAt: lead.appointmentAt, contactAgainOn: lead.contactAgainOn },
    after: { leadStatus: "NO_SHOW", appointmentAt: null, contactAgainOn },
  });
  return after;
}

/** Records the outcome on its checklist step, then lets the steps that wait for it, or for the new status, move. */
async function finishAndFollow(
  db: Db,
  lead: Parameters<typeof applyJourneyEvent>[1],
  effect: "SHOW" | "NO_SHOW",
  now: Date,
  by: string,
  from: FromStep,
) {
  const key = await finishOutcomeStep(db, lead.id, effect, now, by, from.stepId, from.note ?? null);
  if (key) await applyJourneyEvent(db, lead, { kind: "STEP_DONE", key, at: now, by });
  await applyJourneyEvent(db, lead, { kind: "STATUS", at: now, by });
}
