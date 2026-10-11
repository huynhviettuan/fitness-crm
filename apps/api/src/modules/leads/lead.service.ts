import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { isMasked, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import type { OptionListKey } from "@flow/shared/options";
import { assertPhoneFree, leadsVisibleTo } from "../customers/person.service.js";
import { visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import * as repo from "./lead.repository.js";
import { present, visibleLead } from "./lead.present.js";
import { startJourney } from "./lead-journey.service.js";
import {
  BOARD_STATUSES,
  leadBoardQuerySchema,
  leadInputSchema,
  leadUpdateSchema,
  listLeadsSchema,
  type Lead,
  type LeadBoard,
  type LeadPage,
} from "@flow/shared/leads";

// Leads (brief §3, §4.1; D-019, D-020). A lead is a person record in the LEAD stage; it
// becomes a customer at Show with the same id (M2 slice 4). Daily work, so no approval
// (OQ-029 interim); every change is audited (T-048). The journey (assignment, statuses)
// is in lead-journey.service.ts.

const AUDITED_FIELDS = [
  "fullName",
  "gender",
  "dateOfBirth",
  "phone",
  "email",
  "channelId",
  "channelNote",
  "sourceId",
  "sourceNote",
  "sourceType",
  "sourceDetail",
  "nationalityGroup",
  "needGroupId",
  "needGroupNote",
  "needDetail",
  "painStatusId",
  "painStatusNote",
  "assessmentTypeId",
  "assessmentTypeNote",
  "notes",
] as const;

type LeadData = z.output<typeof leadUpdateSchema>;

/** Cards per Kanban column; the list shows the rest of a status. */
const BOARD_COLUMN_SIZE = 30;

export async function listLeads(actor: Actor, rawQuery: unknown): Promise<LeadPage> {
  assertCan(actor, "lead.view");
  const query = parseInput(listLeadsSchema, rawQuery);
  const where: Prisma.CustomerWhereInput = { AND: [filtered(actor, query), { leadStatus: query.status }] };
  const { items, total } = await repo.listLeads(prisma, where, { skip: (query.page - 1) * query.pageSize, take: query.pageSize });
  return { items: items.map((lead) => present(actor, lead)), total, page: query.page, pageSize: query.pageSize };
}

/** The Kanban board (FR-LEAD-006): a column per status a lead can have, with the list's filters. */
export async function leadBoard(actor: Actor, rawQuery: unknown): Promise<LeadBoard> {
  assertCan(actor, "lead.view");
  const where = filtered(actor, parseInput(leadBoardQuerySchema, rawQuery));
  const columns = await Promise.all(
    BOARD_STATUSES.map(async (status) => {
      const { items, total } = await repo.boardColumn(prisma, where, status, BOARD_COLUMN_SIZE);
      return { status, total, items: items.map((lead) => present(actor, lead)) };
    }),
  );
  return { columns };
}

function filtered(actor: Actor, query: z.output<typeof leadBoardQuerySchema>): Prisma.CustomerWhereInput {
  return {
    AND: [
      leadsVisibleTo(actor),
      // A hidden phone number cannot be probed through the search box either (D-017).
      repo.searchWhere(query.q, !isMasked(actor, "customer.phone")),
      { channelId: query.channelId, sourceId: query.sourceId, needGroupId: query.needGroupId },
    ],
  };
}

export async function getLead(actor: Actor, id: string): Promise<Lead> {
  assertCan(actor, "lead.view");
  return present(actor, await visibleLead(prisma, actor, id));
}

/**
 * The quick intake form (FR-LEAD-001). A phone that is already someone's is refused
 * (D-019). The new lead goes round-robin to the branch's next consultant (BR-203).
 */
export async function createLead(actor: Actor, input: unknown, now: Date = new Date()): Promise<Lead> {
  assertCan(actor, "lead.create");
  const { branchId: requested, ...data } = parseInput(leadInputSchema, input);
  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, requested);
    await assertPhoneFree(tx, actor, data.phone, null, customersVisibleTo);
    const created = await repo.createLead(tx, await repo.nextLeadCode(tx), { ...(await toWrite(tx, data, null)), branchId, createdById: actor.id }, now);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "lead",
      entityId: created.id,
      action: "lead.created",
      after: { leadCode: created.leadCode, ...pick(created, AUDITED_FIELDS), branchId },
    });
    return present(actor, await startJourney(tx, actor, created, now));
  });
}

/** Every field is sent; hidden ones keep their value (D-017). */
export async function updateLead(actor: Actor, id: string, input: unknown): Promise<Lead> {
  assertCan(actor, "lead.manage");
  const data = parseInput(leadUpdateSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await visibleLead(tx, actor, id);
    const write = await toWrite(tx, data, before);
    // A user who cannot see a field cannot change it either.
    if (isMasked(actor, "customer.phone")) write.phone = before.phone;
    if (isMasked(actor, "customer.email")) write.email = before.email;
    if (write.phone !== before.phone) await assertPhoneFree(tx, actor, write.phone, id, customersVisibleTo);
    const after = await repo.updateLead(tx, id, write);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (changes) await recordAudit(tx, { actorUserId: actor.id, entityType: "lead", entityId: id, action: "lead.updated", ...changes });
    return present(actor, after);
  });
}

/** Each choice must come from its own list, active or the lead's current one; "Khác" needs a note (D-016). */
async function toWrite(db: Db, data: LeadData, current: repo.LeadRecord | null): Promise<repo.LeadWrite> {
  const choice = async (listKey: OptionListKey, field: string, optionId: string | null, note: string | null, currentId: string | null | undefined) =>
    optionId ? resolveChoice(db, listKey, field, { optionId, note }, currentId ?? null) : { optionId: null, note: null };
  const channel = await resolveChoice(db, "leadChannels", "channelId", { optionId: data.channelId, note: data.channelNote }, current?.channelId ?? null);
  const source = await choice("leadSources", "sourceId", data.sourceId, data.sourceNote, current?.sourceId);
  const needGroup = await choice("needGroups", "needGroupId", data.needGroupId, data.needGroupNote, current?.needGroupId);
  const painStatus = await choice("painStatuses", "painStatusId", data.painStatusId, data.painStatusNote, current?.painStatusId);
  const assessmentType = await choice("assessmentTypes", "assessmentTypeId", data.assessmentTypeId, data.assessmentTypeNote, current?.assessmentTypeId);
  return {
    fullName: data.fullName,
    gender: data.gender,
    dateOfBirth: data.birthDate,
    phone: data.phone,
    email: data.email,
    channelId: channel.optionId,
    channelNote: channel.note,
    sourceId: source.optionId,
    sourceNote: source.note,
    sourceType: data.sourceType,
    sourceDetail: data.sourceDetail,
    nationalityGroup: data.nationalityGroup,
    needGroupId: needGroup.optionId,
    needGroupNote: needGroup.note,
    needDetail: data.needDetail,
    painStatusId: painStatus.optionId,
    painStatusNote: painStatus.note,
    assessmentTypeId: assessmentType.optionId,
    assessmentTypeNote: assessmentType.note,
    notes: data.notes,
  };
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}
