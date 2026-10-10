import { z } from "zod";
import type { Customer, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./customer.repository.js";
import { createCustomerSchema, listCustomersSchema, updateCustomerSchema } from "@flow/shared/customers";

const AUDITED_FIELDS = ["fullName", "phone", "email", "dateOfBirth", "notes", "status"] as const;

export type CustomerPage = {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomers(actor: Actor, rawQuery: unknown): Promise<CustomerPage> {
  assertCan(actor, "customer.view");
  const query = parseInput(listCustomersSchema, rawQuery);
  const { items, total } = await repo.listCustomers(prisma, query, visibleTo(actor));
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getCustomer(actor: Actor, id: string): Promise<Customer> {
  assertCan(actor, "customer.view");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const customer = await repo.findCustomer(prisma, id, visibleTo(actor));
  if (!customer) throw new AppError("NOT_FOUND");
  return customer;
}

export async function createCustomer(actor: Actor, input: unknown): Promise<Customer> {
  assertCan(actor, "customer.manage");
  const data = parseInput(createCustomerSchema, input);

  return prisma.$transaction(async (tx) => {
    const code = await repo.nextCustomerCode(tx);
    const customer = await repo.createCustomer(tx, code, data);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "customer",
      entityId: customer.id,
      action: "customer.created",
      metadata: { customerCode: customer.customerCode },
    });
    return customer;
  });
}

export async function updateCustomer(actor: Actor, id: string, input: unknown): Promise<Customer> {
  assertCan(actor, "customer.manage");
  const data = parseInput(updateCustomerSchema, input);

  return prisma.$transaction(async (tx) => {
    const before = await repo.findCustomer(tx, id, visibleTo(actor));
    if (!before) throw new AppError("NOT_FOUND");

    const after = await repo.updateCustomer(tx, id, data);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "customer",
        entityId: id,
        action: "customer.updated",
        metadata: { changes },
      });
    }
    return after;
  });
}

/**
 * Which customers an actor may see. Trainers see only customers with a booking
 * assigned to them (OQ-006 interim, docs/09).
 */
function visibleTo(actor: Actor): Prisma.CustomerWhereInput {
  if (actor.role === "TRAINER") return { bookings: { some: { trainer: { userId: actor.id } } } };
  return {};
}
