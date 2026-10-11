import {
  RECARE_STATUSES,
  isRecareOverdue,
  recareQuerySchema,
  type RecarePage,
  type RecareRow,
} from "@flow/shared/leads";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { isMasked } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { chosen } from "../../platform/options/option.service.js";
import { leadsVisibleTo } from "../customers/person.service.js";
import * as repo from "./lead.repository.js";

// The re-care list (brief §4.1 step 10, FR-LEAD-007, BR-204): leads in No response, Refused,
// or No show, by the day to contact them again. "Mine" is the leads in my charge.

export async function recareList(actor: Actor, rawQuery: unknown, now: Date = new Date()): Promise<RecarePage> {
  assertCan(actor, "lead.view");
  const query = parseInput(recareQuerySchema, rawQuery);
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE, now);
  const matching: Prisma.CustomerWhereInput = {
    AND: [
      leadsVisibleTo(actor),
      { leadStatus: query.status ?? { in: [...RECARE_STATUSES] } },
      query.scope === "mine" ? { picUserId: actor.id } : {},
      query.picUserId ? { picUserId: query.picUserId } : {},
    ],
  };
  const overdue: Prisma.CustomerWhereInput = { contactAgainOn: { lt: today } };
  const where: Prisma.CustomerWhereInput = query.overdue ? { AND: [matching, overdue] } : matching;
  const { items, total, overdueTotal } = await repo.recareRows(prisma, where, overdue, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  const phoneHidden = isMasked(actor, "customer.phone");
  return {
    items: items.map((lead): RecareRow => {
      // A re-care row always has a re-care status (the query) and a lead code (database check customers_stage_codes).
      return {
        id: lead.id,
        leadCode: lead.leadCode ?? "",
        fullName: lead.fullName,
        phone: phoneHidden ? null : lead.phone,
        status: lead.leadStatus as RecareRow["status"],
        statusChangedAt: lead.leadStatusChangedAt ?? lead.createdAt,
        contactAgainOn: lead.contactAgainOn,
        overdue: isRecareOverdue(lead.contactAgainOn, today),
        refuseReason: lead.refuseReason ? chosen(lead.refuseReason, lead.refuseReasonNote) : null,
        pic: lead.pic,
        branch: lead.branch,
        maskedFields: phoneHidden ? ["phone"] : [],
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
    overdueTotal,
  };
}
