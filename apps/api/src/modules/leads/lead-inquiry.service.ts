import { z } from "zod";
import { AppError } from "../../platform/errors/app-error.js";
import {
  inquiryReopens,
  leadInquiryInputSchema,
  type InquiryResult,
  type PersonIntakeHistory,
} from "@gymcrm/shared/leads";
import { prisma } from "../../platform/db/prisma.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { notify } from "../../platform/notifications/notification.service.js";
import * as leads from "./lead.repository.js";
import * as repo from "./merge.repository.js";
import { present, visiblePerson } from "./lead.present.js";
import { assign, link, moveLead, nextReceiver } from "./lead-journey.service.js";
import { inquiryView, intakeEntries } from "./intake-history.js";

// A person who wrote or came in again (BR-202, FR-LEAD-009, D-019, A-063): the inquiry is
// added to the record they already have; no second person is created. Daily work, so no
// approval (OQ-029 interim); audited (T-048).

/**
 * Adds an inquiry to an existing lead or customer record the actor may see (A-063, A-068).
 * A lead keeps its consultant while they still receive leads in the branch, else the
 * round-robin gives it to the next; a lead in re-care goes back to Consulting. On a
 * customer the inquiry is only recorded. The consultant and, when the work re-opens or the
 * record is a customer, the branch's managers are told.
 */
export async function addInquiry(
  actor: Actor,
  personId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<InquiryResult> {
  assertCan(actor, "lead.create");
  const data = parseInput(leadInquiryInputSchema, input);
  return prisma.$transaction(async (tx) => {
    // A malformed id is not found, and must not reach the raw lock query.
    if (!z.uuid().safeParse(personId).success) throw new AppError("NOT_FOUND");
    await leads.lockLead(tx, personId);
    let person = await visiblePerson(tx, actor, personId);
    const channel = await resolveChoice(tx, "leadChannels", "channelId", {
      optionId: data.channelId,
      note: data.channelNote,
    });
    const choice = async (
      listKey: "leadSources" | "needGroups",
      field: string,
      id: string | null,
      note: string | null,
    ) => (id ? resolveChoice(tx, listKey, field, { optionId: id, note }) : { optionId: null, note: null });
    const source = await choice("leadSources", "sourceId", data.sourceId, data.sourceNote);
    const needGroup = await choice("needGroups", "needGroupId", data.needGroupId, data.needGroupNote);
    const created = await repo.createInquiry(tx, {
      personId,
      branchId: person.branchId,
      createdById: actor.id,
      channelId: channel.optionId,
      channelNote: channel.note,
      sourceId: source.optionId,
      sourceNote: source.note,
      sourceType: data.sourceType,
      sourceDetail: data.sourceDetail,
      needGroupId: needGroup.optionId,
      needGroupNote: needGroup.note,
      needDetail: data.needDetail,
      note: data.note,
    });

    let reopened = false;
    if (person.stage === "LEAD") {
      // Still with their consultant while that person receives leads in the branch; else the next in turn.
      const receivers = await leads.receivers(tx, person.branchId);
      if (!person.picUserId || !receivers.some((user) => user.id === person.picUserId)) {
        const next = await nextReceiver(tx, person.branchId, now);
        if (next) person = await assign(tx, actor, person, next, null, now);
      }
      if (inquiryReopens(person.leadStatus)) {
        person = await moveLead(
          tx,
          actor,
          person,
          { status: "CONSULTING", appointment: null, refuseReason: null, note: null },
          now,
        );
        reopened = true;
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: person.stage === "LEAD" ? "lead" : "customer",
      entityId: person.id,
      action: "person.inquiry_added",
      after: {
        inquiryId: created.id,
        channelId: created.channelId,
        sourceId: created.sourceId,
        needGroupId: created.needGroupId,
        reopened,
      },
    });
    const managers = reopened || person.stage === "CUSTOMER" ? await leads.leadManagers(tx, person.branchId) : [];
    await notify(
      tx,
      [person.picUserId, ...managers].filter((id) => id !== actor.id),
      {
        kind: "leadInquiry",
        params: { code: code(person), name: person.fullName },
        link: person.stage === "LEAD" ? link(person) : `/customers/${person.id}`,
      },
    );
    return {
      inquiry: inquiryView(created),
      personId: person.id,
      stage: person.stage,
      code: code(person),
      reopened,
      pic: present(actor, person).pic,
    };
  });
}

/** Inquiries and merges of a lead or customer record, newest first. */
export async function personIntakeHistory(actor: Actor, personId: string): Promise<PersonIntakeHistory> {
  assertCan(actor, "lead.view");
  const person = await visiblePerson(prisma, actor, personId);
  return { items: await intakeEntries(prisma, person.id) };
}

/** The code the record is known by: the lead code of a lead, the customer code of a customer. */
const code = (person: leads.LeadRecord) => (person.stage === "LEAD" ? person.leadCode : person.customerCode) ?? "";
