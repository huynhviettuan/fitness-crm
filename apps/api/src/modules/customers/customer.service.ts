import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./customer.repository.js";
import {
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
  type Customer,
  type CustomerPage,
} from "@flow/shared/customers";

const AUDITED_FIELDS = ["fullName", "phone", "email", "dateOfBirth", "notes", "status"] as const;

export async function listCustomers(actor: Actor, rawQuery: unknown): Promise<CustomerPage> {
  assertCan(actor, "customer.view");
  const query = parseInput(listCustomersSchema, rawQuery);
  // A hidden phone number cannot be probed through the search box either (D-017).
  const searchPhone = !isMasked(actor, "customer.phone");
  const { items, total } = await repo.listCustomers(prisma, query, visibleTo(actor), searchPhone);
  return { items: items.map((c) => present(actor, c)), total, page: query.page, pageSize: query.pageSize };
}

export async function getCustomer(actor: Actor, id: string): Promise<Customer> {
  assertCan(actor, "customer.view");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const customer = await repo.findCustomer(prisma, id, visibleTo(actor));
  if (!customer) throw new AppError("NOT_FOUND");
  return present(actor, customer);
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

export async function updateCustomer(actor: Actor, id: string, input: unknown): Promise<Customer> {
  assertCan(actor, "customer.manage");
  const data = parseInput(updateCustomerSchema, input);
  // A user who cannot see a field cannot change it either (D-017).
  if (isMasked(actor, "customer.phone")) delete data.phone;
  if (isMasked(actor, "customer.email")) delete data.email;

  return prisma.$transaction(async (tx) => {
    const before = await repo.findCustomer(tx, id, visibleTo(actor));
    if (!before) throw new AppError("NOT_FOUND");

    const after = await repo.updateCustomer(tx, id, data);
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
    return present(actor, after);
  });
}

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
function present(actor: Actor, customer: repo.CustomerRecord): Customer {
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
  };
}
