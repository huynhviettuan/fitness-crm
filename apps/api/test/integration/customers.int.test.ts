import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../../src/modules/customers/customer.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, withoutApprovals } from "../support/factories.js";

afterEach(resetDatabase);

const validCustomer = { fullName: "Nguyễn Văn An", phone: "0909 123 456" };

describe("createCustomer", () => {
  it("generates a KH code and writes the audit event (BR-001, T-022)", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    const customer = await createCustomer(actor, { ...validCustomer, dateOfBirth: "15/03/1990" });

    expect(customer.customerCode).toMatch(/^KH\d{6,}$/);
    expect(customer.phone).toBe("0909123456");
    expect(customer.dateOfBirth?.toISOString()).toBe("1990-03-15T00:00:00.000Z");
    const audit = await prisma.auditEvent.findMany({ where: { entityId: customer.id } });
    expect(audit).toEqual([
      expect.objectContaining({ action: "customer.created", actorUserId: actor.id, entityType: "customer" }),
    ]);
  });

  it("gives every customer a different code when created at the same time (T-019)", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    const customers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createCustomer(actor, { ...validCustomer, fullName: `Khách ${i}` })),
    );

    const codes = new Set(customers.map((c) => c.customerCode));
    expect(codes.size).toBe(10);
  });

  it.each(["PT", "ACCOUNTANT"] as const)("rejects a %s (docs/09)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createCustomer(actor, validCustomer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.customer.count()).toBe(0);
  });

  it("returns field errors as i18n keys and saves nothing", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(createCustomer(actor, { fullName: "", phone: "abc" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { fullName: ["required"], phone: ["invalidPhone"] },
    });
    expect(await prisma.customer.count()).toBe(0);
  });
});
// These tests are about something else than approvals (approvals.int.test.ts).
beforeEach(async () => {
  await withoutApprovals();
});


describe("updateCustomer", () => {
  it("audits only the fields that changed, with before and after", async () => {
    const { actor } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(actor, validCustomer);

    await updateCustomer(actor, customer.id, { phone: "0911 222 333", fullName: validCustomer.fullName });

    const updated = await prisma.auditEvent.findFirstOrThrow({ where: { action: "customer.updated" } });
    expect(updated).toMatchObject({ before: { phone: "0909123456" }, after: { phone: "0911222333" } });
  });

  it("writes no audit event when nothing changed", async () => {
    const { actor } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(actor, validCustomer);

    await updateCustomer(actor, customer.id, { fullName: validCustomer.fullName });

    expect(await prisma.auditEvent.count({ where: { action: "customer.updated" } })).toBe(0);
  });

  it("never changes the customer code (BR-001)", async () => {
    const { actor } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(actor, validCustomer);

    const { customer: updated } = await updateCustomer(actor, customer.id, { customerCode: "KH999999", status: "INACTIVE" });

    expect(updated.customerCode).toBe(customer.customerCode);
    expect(updated.status).toBe("INACTIVE");
  });

  it("keeps the search name in sync with the full name", async () => {
    const { actor } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(actor, validCustomer);

    await updateCustomer(actor, customer.id, { fullName: "Trần Thị Bích" });

    const page = await listCustomers(actor, { q: "tran thi bich" });
    expect(page.items.map((c) => c.id)).toEqual([customer.id]);
  });
});

describe("listCustomers search (FR-CUS-002)", () => {
  it.each<[string, (match: { customerCode: string }) => string]>([
    ["name without accents", () => "nguyen van"],
    ["name with accents, any case", () => "NGUYỄN VĂN"],
    ["customer code, any case", (match) => match.customerCode.toLowerCase()],
    ["part of the phone, typed with spaces", () => "0909 123"],
  ])("finds by %s", async (_label, queryFor) => {
    const { actor } = await createTestUser("RECEPTIONIST");
    const match = await createCustomer(actor, validCustomer);
    await createCustomer(actor, { fullName: "Lê Thị Hoa", phone: "0388777666" });

    const page = await listCustomers(actor, { q: queryFor(match) });

    expect(page.items.map((c) => c.id)).toEqual([match.id]);
  });

  it("paginates newest first", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    for (let i = 0; i < 3; i++) await createCustomer(actor, { ...validCustomer, fullName: `Khách ${i}` });

    const page = await listCustomers(actor, { page: 2, pageSize: 2 });

    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items.map((c) => c.fullName)).toEqual(["Khách 0"]);
  });
});

describe("customer visibility", () => {
  it("a trainer sees no customers until bookings exist (OQ-006 interim)", async () => {
    const { actor: receptionist } = await createTestUser("RECEPTIONIST");
    const { actor: trainer } = await createTestUser("PT");
    const customer = await createCustomer(receptionist, validCustomer);

    expect((await listCustomers(trainer, {})).total).toBe(0);
    await expect(getCustomer(trainer, customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an unknown or malformed id is NOT_FOUND", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(getCustomer(actor, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCustomer(actor, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
