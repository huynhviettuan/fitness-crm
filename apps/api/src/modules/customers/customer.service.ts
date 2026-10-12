import { z } from "zod";
import { instantAt } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { unseal } from "../../platform/security/sensitive.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { activeInBranch } from "../../platform/notifications/notification.service.js";
import { env } from "../../platform/env.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { ruleFor, submitForApproval, withPendingConflictMapped } from "../../platform/approvals/approval.engine.js";
import * as repo from "./customer.repository.js";
import { assertPhoneFree } from "./person.service.js";
import {
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
  type Customer,
  type CustomerPage,
} from "@flow/shared/customers";

const AUDITED_FIELDS = [
  "fullName",
  "phone",
  "email",
  "dateOfBirth",
  "notes",
  "status",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
  "customerGroupId",
  "customerGroupNote",
  "picUserId",
] as const;

/** A customer's identity: changing it needs approval when the matrix says so (D-018, 09_RBAC.md). */
const IDENTITY_FIELDS = ["fullName", "phone", "email"] as const;
type IdentityChange = { fullName?: string; phone?: string; email?: string | null };

export async function listCustomers(actor: Actor, rawQuery: unknown): Promise<CustomerPage> {
  assertCan(actor, "customer.view");
  const query = parseInput(listCustomersSchema, rawQuery);
  // A hidden phone number cannot be probed through the search box either (D-017).
  const searchPhone = !isMasked(actor, "customer.phone");
  const { items, total } = await repo.listCustomers(prisma, query, visibleTo(actor), searchPhone, {
    branchId: query.branchId,
    staffId: query.staffId,
    registeredFrom: query.registeredFrom ? instantAt(query.registeredFrom, "00:00", env.GYM_TIMEZONE) : undefined,
    // The end day is included: up to the start of the next one.
    registeredBefore: query.registeredTo
      ? new Date(instantAt(query.registeredTo, "00:00", env.GYM_TIMEZONE).getTime() + 86_400_000)
      : undefined,
    birthdayMonth: query.birthdayMonth,
    noEmail: query.noEmail && !isMasked(actor, "customer.email"),
  });
  const pending = await pendingIdentities(
    prisma,
    items.map((c) => c.id),
  );
  return {
    items: items.map((c) => present(actor, c, pending.get(c.id))),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** The active users of the actor's branches, for the staff-in-charge choice and filter (A-071). */
export async function staffChoices(actor: Actor): Promise<{ id: string; name: string }[]> {
  assertCan(actor, "customer.view");
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      ...(actor.branches === "ALL"
        ? {}
        : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: [...actor.branches] } } } }] }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getCustomer(actor: Actor, id: string): Promise<Customer> {
  assertCan(actor, "customer.view");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const customer = await repo.findCustomer(prisma, id, visibleTo(actor));
  if (!customer) throw new AppError("NOT_FOUND");
  return present(actor, customer, (await pendingIdentities(prisma, [id])).get(id));
}

/** The customer goes to the chosen branch, or the actor's only branch (D-014). */
export async function createCustomer(actor: Actor, input: unknown): Promise<Customer> {
  assertCan(actor, "customer.manage");
  const { branchId: requestedBranch, ...data } = parseInput(createCustomerSchema, input);
  if (isMasked(actor, "customer.address")) clearAddress(data);

  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, requestedBranch);
    await assertPhoneFree(tx, actor, data.phone, null, visibleTo);
    const code = await repo.nextCustomerCode(tx);
    const { customerGroupId, customerGroupNote, staffInChargeId, ...own } = data;
    const profile = await profileWrite(tx, branchId, { customerGroupId, customerGroupNote, staffInChargeId }, null);
    const customer = await repo.createCustomer(tx, code, { ...own, ...profile, branchId, createdById: actor.id });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "customer",
      entityId: customer.id,
      action: "customer.created",
      after: { customerCode: customer.customerCode, fullName: customer.fullName, branchId },
    });
    return present(actor, customer);
  });
}

/**
 * Edits a customer. When the matrix requires it, a change of name, phone, or email
 * waits for approval while the other fields change at once (D-018); `approval` is the
 * request it created, if any.
 */
export async function updateCustomer(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ customer: Customer; approval: { id: string } | null }> {
  assertCan(actor, "customer.manage");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const data = parseInput(updateCustomerSchema, input);
  // A user who cannot see a field cannot change it either (D-017).
  if (isMasked(actor, "customer.phone")) delete data.phone;
  if (isMasked(actor, "customer.email")) delete data.email;
  if (isMasked(actor, "customer.address")) clearAddress(data);

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await repo.findCustomer(tx, id, visibleTo(actor));
      if (!before) throw new AppError("NOT_FOUND");
      if (data.phone !== undefined && data.phone !== before.phone)
        await assertPhoneFree(tx, actor, data.phone, id, visibleTo);

      const { customerGroupId, customerGroupNote, staffInChargeId, ...own } = data;
      const profile = await profileWrite(
        tx,
        before.branchId,
        { customerGroupId, customerGroupNote, staffInChargeId },
        before,
      );

      const identity: IdentityChange = {};
      for (const field of IDENTITY_FIELDS) {
        if (data[field] !== undefined && data[field] !== before[field])
          Object.assign(identity, { [field]: data[field] });
      }
      const held = Object.keys(identity).length > 0 && (await ruleFor(tx, "customer.identity")).required;
      const edit = { ...own, ...profile };
      const applied = held ? Object.fromEntries(Object.entries(edit).filter(([key]) => !(key in identity))) : edit;

      const after = await repo.updateCustomer(tx, id, applied);
      const changes = diffFields(before, after, AUDITED_FIELDS);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "customer",
          entityId: id,
          action: "customer.updated",
          ...changes,
        });
      }
      const approval = held
        ? await submitForApproval(tx, actor, {
            action: "customer.identity",
            entityType: "customer",
            entityId: id,
            branchId: before.branchId,
            title: `${before.customerCode ?? ""} · ${before.fullName}`,
            amount: null,
            payload: identity,
          })
        : null;
      return { customer: present(actor, after, (await pendingIdentities(tx, [id])).get(id)), approval };
    }),
  );
}

type ProfileChoices = {
  customerGroupId?: string | null;
  customerGroupNote?: string | null;
  staffInChargeId?: string | null;
};

/**
 * The profile choices as columns: the group from its list, "Khác" with a note (D-016,
 * A-070), and the staff in charge among the active users of the customer's branch (A-071).
 * A choice left out of the request is left alone; the staff already in charge stays valid.
 */
async function profileWrite(
  db: Db,
  branchId: string,
  choices: ProfileChoices,
  current: { customerGroupId: string | null; picUserId: string | null } | null,
): Promise<Partial<repo.CustomerWrite>> {
  const write: Partial<repo.CustomerWrite> = {};
  if (choices.customerGroupId !== undefined) {
    if (choices.customerGroupId === null) {
      write.customerGroupId = null;
      write.customerGroupNote = null;
    } else {
      const group = await resolveChoice(
        db,
        "customerGroups",
        "customerGroupId",
        { optionId: choices.customerGroupId, note: choices.customerGroupNote ?? null },
        current?.customerGroupId ?? null,
      );
      write.customerGroupId = group.optionId;
      write.customerGroupNote = group.note;
    }
  }
  if (choices.staffInChargeId !== undefined) {
    if (choices.staffInChargeId !== null && choices.staffInChargeId !== current?.picUserId) {
      const staff = await db.user.findFirst({
        where: { AND: [{ id: choices.staffInChargeId }, activeInBranch(branchId)] },
        select: { id: true },
      });
      if (!staff) throw new AppError("VALIDATION_FAILED", { fieldErrors: { staffInChargeId: ["invalidChoice"] } });
    }
    write.picUserId = choices.staffInChargeId;
  }
  return write;
}

/** A user who cannot see the address and the emergency contact cannot change them either (A-069). */
function clearAddress(data: { address?: unknown; emergencyContactName?: unknown; emergencyContactPhone?: unknown }) {
  delete data.address;
  delete data.emergencyContactName;
  delete data.emergencyContactPhone;
}

/** Applies an approved identity change (D-018), audited as an edit of the customer. */
export async function applyIdentityChange(
  db: Db,
  decider: Pick<Actor, "id">,
  id: string,
  change: IdentityChange,
  requestId: string,
): Promise<void> {
  const before = await repo.findCustomer(db, id);
  if (!before) throw new AppError("NOT_FOUND");
  const after = await repo.updateCustomer(db, id, change);
  const changes = diffFields(before, after, AUDITED_FIELDS);
  if (changes) {
    await recordAudit(db, {
      actorUserId: decider.id,
      entityType: "customer",
      entityId: id,
      action: "customer.updated",
      ...changes,
      context: { approvalRequestId: requestId },
    });
  }
}

/** Identity changes waiting for approval, per customer. */
async function pendingIdentities(db: Db, customerIds: string[]): Promise<Map<string, PendingIdentity>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db.approvalRequest.findMany({
    where: { actionType: "customer.identity", entityId: { in: customerIds }, status: "PENDING" },
    select: { id: true, entityId: true, payload: true },
  });
  return new Map(rows.map((row) => [row.entityId, { approvalId: row.id, ...(row.payload as IdentityChange) }]));
}

type PendingIdentity = { approvalId: string } & IdentityChange;

/**
 * The customers an actor is responsible for (A-029): ones they created, and ones with a
 * booking with them as the trainer. Until M2 adds lead owners.
 */
export function ownCustomers(actor: Pick<Actor, "id" | "employeeId">): Prisma.CustomerWhereInput {
  return {
    OR: [
      { createdById: actor.id },
      ...(actor.employeeId ? [{ bookings: { some: { trainerId: actor.employeeId } } }] : []),
    ],
  };
}

/**
 * Which customers an actor may see: people past Show (leads are on the lead screens,
 * D-019), in their branches, and only their own with "own" scope (D-017).
 */
export function visibleTo(actor: Actor): Prisma.CustomerWhereInput {
  return {
    AND: [
      { stage: "CUSTOMER" },
      { mergedIntoId: null },
      inBranches(actor),
      isOwnOnly(actor, "customers") ? ownCustomers(actor) : {},
    ],
  };
}

/** The customer as this actor may see it: masked fields are null and listed (D-017). */
function present(actor: Actor, customer: repo.CustomerRecord, pending?: PendingIdentity): Customer {
  const maskedFields: Customer["maskedFields"] = [];
  if (isMasked(actor, "customer.phone")) maskedFields.push("phone");
  if (isMasked(actor, "customer.email")) maskedFields.push("email");
  if (isMasked(actor, "customer.address")) maskedFields.push("address");
  if (isMasked(actor, "customer.idDocument")) maskedFields.push("idDocument");
  if (isMasked(actor, "customer.health")) maskedFields.push("health");
  return {
    id: customer.id,
    // A customer always has a code (database check customers_stage_codes).
    customerCode: customer.customerCode ?? "",
    branch: customer.branch,
    fullName: customer.fullName,
    phone: maskedFields.includes("phone") ? null : customer.phone,
    email: maskedFields.includes("email") ? null : customer.email,
    dateOfBirth: customer.dateOfBirth,
    status: customer.status,
    idDocumentType: customer.idDocumentType,
    // Decrypted only for someone who may see it (D-042).
    idDocumentNumber: maskedFields.includes("idDocument") ? null : unseal(customer.idDocumentNumber),
    countryCode: customer.countryCode,
    nationality: customer.nationality,
    healthNote: maskedFields.includes("health") ? null : unseal(customer.healthNote),
    dataConsentAt: customer.dataConsentAt,
    address: maskedFields.includes("address") ? null : customer.address,
    emergencyContactName: maskedFields.includes("address") ? null : customer.emergencyContactName,
    emergencyContactPhone: maskedFields.includes("address") ? null : customer.emergencyContactPhone,
    customerGroup: customer.customerGroup && chosen(customer.customerGroup, customer.customerGroupNote),
    staffInCharge: customer.pic,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    maskedFields,
    pendingIdentity: pending ? maskIdentity(pending, maskedFields) : null,
  };
}

function maskIdentity(
  pending: PendingIdentity,
  masked: Customer["maskedFields"],
): NonNullable<Customer["pendingIdentity"]> {
  const { phone, email, ...rest } = pending;
  return {
    ...rest,
    ...(phone !== undefined && !masked.includes("phone") ? { phone } : {}),
    ...(email !== undefined && !masked.includes("email") ? { email } : {}),
  };
}
