import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { prisma } from "../../src/platform/db/prisma.js";
import { env } from "../../src/platform/env.js";
import type { CurrentUser } from "../../src/platform/auth/actor.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import { changeLeadStatus } from "../../src/modules/leads/lead-journey.service.js";
import { noShowLead } from "../../src/modules/leads/lead-outcome.service.js";
import { createTestOption, optionId, uniquePhone } from "./factories.js";

export const DAY_MS = 86_400_000;

/** The gym's today as a date at UTC midnight (A-001). */
export const gymToday = () => calendarDateInTimeZone(env.GYM_TIMEZONE);

/** A date `days` from the gym's today (negative: in the past), at UTC midnight. */
export const gymDay = (days: number) => new Date(gymToday().getTime() + days * DAY_MS);

/** A lead in the shared branch, with a phone of its own and the WhatsApp channel. */
export async function newLead(actor: CurrentUser, fullName: string, extra: Record<string, unknown> = {}) {
  return createLead(actor, {
    fullName,
    phone: uniquePhone(),
    channelId: await optionId("leadChannels", "WhatsApp"),
    ...extra,
  });
}

/** A refusal reason made for the test. */
export const refuseReason = () => createTestOption("leadRefuseReasons", `Lý do ${Math.random().toString(36).slice(2)}`);

/**
 * Puts a lead (in `actor`'s charge or any who may change it) into one of the re-care
 * statuses through the real status change, then sets its contact-again day when given.
 */
export async function intoRecare(
  actor: CurrentUser,
  leadId: string,
  status: "NO_RESPONSE" | "REFUSED" | "NO_SHOW",
  contactAgainOn?: Date | null,
): Promise<void> {
  if (status === "NO_SHOW") {
    await changeLeadStatus(actor, leadId, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:30",
    });
    await noShowLead(actor, leadId);
  } else if (status === "REFUSED") {
    await changeLeadStatus(actor, leadId, { status, refuseReasonId: await refuseReason() });
  } else {
    await changeLeadStatus(actor, leadId, { status });
  }
  if (contactAgainOn !== undefined) {
    await prisma.customer.update({ where: { id: leadId }, data: { contactAgainOn } });
  }
}
