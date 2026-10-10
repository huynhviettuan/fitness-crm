import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { ruleFor, submitForApproval, withPendingConflictMapped } from "../../platform/approvals/approval.engine.js";
import * as repo from "./customer.repository.js";
import {
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
  type Customer,
  type CustomerPage,
} from "@flow/shared/customers";

const AUDITED_FIELDS = ["fullName", "phone", "email", "dateOfBirth", "notes", "status"] as const;

/** A customer's identity: changing it needs approval when the matrix says so (D-018, 09_RBAC.md). */
const IDENTITY_FIELDS = ["fullName", "phone", "email"] as const;
type IdentityChange = { fullName?: string; phone?: string; email?: string | null };

export async function listCustomers(actor: Actor, rawQuery: unknown): Promise<CustomerPage> {
  assertCan(actor, "customer.view");
  const query = parseInput(listCustomersSchema, rawQuery);
  // A hidden phone number cannot be probed through the search box either (D-017).
  const searchPhone = !isMasked(actor, "customer.phone");
  const { items, total } = await repo.listCustomers(prisma, query, visibleTo(actor), searchPhone);
  const pending = await pendingIdentities(prisma, items.map((c) => c.id));
  return { items: items.map((c) => present(actor, c, pending.get(c.id))), total, page: query.page, pageSize: query.pageSize };
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

  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, requestedBranch);
    const code = await repo.nextCustomerCode(tx);
    const customer = await repo.createCustomer(tx, code, { ...data, branchId, createdById: actor.id });
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
export async function updateCustomer(actor: Actor, id: string, input: unknown): Promise<{ customer: Customer; approval: { id: string } | null }> {
  assertCan(actor, "customer.manage");
  const data = parseInput(updateCustomerSchema, input);
  // A user who cannot see a field cannot change it either (D-017).
  if (isMasked(actor, "customer.phone")) delete data.phone;
  if (isMasked(actor, "customer.email")) delete data.email;

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await repo.findCustomer(tx, id, visibleTo(actor));
      if (!before) throw new AppError("NOT_FOUND");

      const identity: IdentityChange = {};
      for (const field of IDENTITY_FIELDS) {
        if (data[field] !== undefined && data[field] !== before[field]) Object.assign(identity, { [field]: data[field] });
      }
      const held = Object.keys(identity).length > 0 && (await ruleFor(tx, "customer.identity")).required;
      const applied = held ? Object.fromEntries(Object.entries(data).filter(([key]) => !(key in identity))) : data;

      const after = await repo.updateCustomer(tx, id, applied);
      const changes = diffFields(before, after, AUDITED_FIELDS);
      if (changes) {
        await recordAudit(tx, { actorUserId: actor.id, entityType: "customer", entityId: id, action: "customer.updated", ...changes });
      }
      const approval = held
        ? await submitForApproval(tx, actor, {
            action: "customer.identity",
            entityType: "customer",
            entityId: id,
            branchId: before.branchId,
            title: `${before.customerCode} · ${before.fullName}`,
            amount: null,
            payload: identity,
          })
        : null;
      return { customer: present(actor, after, (await pendingIdentities(tx, [id])).get(id)), approval };
    }),
  );
}

/** Applies an approved identity change (D-018), audited as an edit of the customer. */
export async function applyIdentityChange(db: Db, decider: Pick<Actor, "id">, id: string, change: IdentityChange, requestId: string): Promise<void> {
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
 * booking with the trainer record they act as. Until M2 adds lead owners.
 */
export function ownCustomers(actor: Pick<Actor, "id" | "trainerId">): Prisma.CustomerWhereInput {
  return {
    OR: [{ createdById: actor.id }, ...(actor.trainerId ? [{ bookings: { some: { trainerId: actor.trainerId } } }] : [])],
  };
}

/** Which customers an actor may see: their branches, and only their own with "own" scope (D-017). */
export function visibleTo(actor: Actor): Prisma.CustomerWhereInput {
  return { AND: [inBranches(actor), isOwnOnly(actor, "customers") ? ownCustomers(actor) : {}] };
}

/** The customer as this actor may see it: masked fields are null and listed (D-017). */
function present(actor: Actor, customer: repo.CustomerRecord, pending?: PendingIdentity): Customer {
  const maskedFields: Customer["maskedFields"] = [];
  if (isMasked(actor, "customer.phone")) maskedFields.push("phone");
  if (isMasked(actor, "customer.email")) maskedFields.push("email");
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    branch: customer.branch,
    fullName: customer.fullName,
    phone: maskedFields.includes("phone") ? null : customer.phone,
    email: maskedFields.includes("email") ? null : customer.email,
    dateOfBirth: customer.dateOfBirth,
    status: customer.status,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    maskedFields,
    pendingIdentity: pending ? maskIdentity(pending, maskedFields) : null,
  };
}

function maskIdentity(pending: PendingIdentity, masked: Customer["maskedFields"]): NonNullable<Customer["pendingIdentity"]> {
  const { phone, email, ...rest } = pending;
  return {
    ...rest,
    ...(phone !== undefined && !masked.includes("phone") ? { phone } : {}),
    ...(email !== undefined && !masked.includes("email") ? { email } : {}),
  };
}
