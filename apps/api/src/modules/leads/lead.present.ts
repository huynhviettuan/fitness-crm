import { z } from "zod";
import type { Lead } from "@flow/shared/leads";
import type { Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { chosen } from "../../platform/options/option.service.js";
import { isMasked } from "../../platform/permissions/scope.js";
import type { Actor } from "../../platform/auth/session.js";
import { leadsVisibleTo } from "../customers/person.service.js";
import * as repo from "./lead.repository.js";

/** A lead the actor may see, or NOT_FOUND (docs/07). */
export async function visibleLead(db: Db, actor: Actor, id: string): Promise<repo.LeadRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const lead = await repo.findLead(db, id, leadsVisibleTo(actor));
  if (!lead) throw new AppError("NOT_FOUND");
  return lead;
}

/** The same, locked until the transaction ends, so two changes of its journey never interleave. */
export async function lockedLead(db: Db, actor: Actor, id: string): Promise<repo.LeadRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  await repo.lockLead(db, id);
  return visibleLead(db, actor, id);
}

/** The lead as this actor may see it: hidden fields are null and listed (D-017). */
export function present(actor: Actor, lead: repo.LeadRecord): Lead {
  const maskedFields: Lead["maskedFields"] = [];
  if (isMasked(actor, "customer.phone")) maskedFields.push("phone");
  if (isMasked(actor, "customer.email")) maskedFields.push("email");
  const option = <T extends { id: string; labelVi: string; labelEn: string; isOther: boolean } | null>(
    value: T,
    note: string | null,
  ) => (value ? chosen(value, note) : null);
  return {
    id: lead.id,
    // A lead always has its code, status, and status time (database check customers_stage_codes).
    leadCode: lead.leadCode ?? "",
    customerCode: lead.customerCode,
    stage: lead.stage,
    status: lead.leadStatus ?? "NEW",
    statusChangedAt: lead.leadStatusChangedAt ?? lead.createdAt,
    appointmentAt: lead.appointmentAt,
    contactAgainOn: lead.contactAgainOn,
    refuseReason: option(lead.refuseReason, lead.refuseReasonNote),
    branch: lead.branch,
    fullName: lead.fullName,
    gender: lead.gender,
    birthDate: lead.dateOfBirth,
    phone: maskedFields.includes("phone") ? null : lead.phone,
    email: maskedFields.includes("email") ? null : lead.email,
    channel: chosen(
      lead.channel ?? { id: lead.channelId ?? "", labelVi: "", labelEn: "", isOther: false },
      lead.channelNote,
    ),
    source: option(lead.source, lead.sourceNote),
    sourceType: lead.sourceType,
    sourceDetail: lead.sourceDetail,
    nationalityGroup: lead.nationalityGroup,
    needGroup: option(lead.needGroup, lead.needGroupNote),
    needDetail: lead.needDetail,
    painStatus: option(lead.painStatus, lead.painStatusNote),
    assessmentType: option(lead.assessmentType, lead.assessmentTypeNote),
    pic: lead.pic,
    notes: lead.notes,
    createdBy: lead.createdBy,
    createdAt: lead.createdAt,
    maskedFields,
  };
}
