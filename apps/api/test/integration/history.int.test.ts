import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { listAuditEvents } from "../../src/platform/audit/audit.service.js";
import { listTrash } from "../../src/platform/trash/trash.service.js";
import { createCustomer, updateCustomer } from "../../src/modules/customers/customer.service.js";
import { deletePayment, recordPayment } from "../../src/modules/finance/payment.service.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestBranch, createTestUser, optionId, roleId } from "../support/factories.js";
import { activeContract } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});

const OTHER_REASON = await optionId("deleteReasons", "Khác");
const CASH = await optionId("paymentMethods", "Tiền mặt");

/** A payment of 5,000,000 that an admin deleted with the note "Trùng". */
async function deletedPayment() {
  const { actor: admin } = await createTestUser("ADMIN");
  const customer = await createCustomer(admin, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const contract = await activeContract(admin, customer.id);
  const { payment } = await recordPayment(admin, contract.id, { amount: 5_000_000, methodId: CASH, paidOn: "05/10/2026" }, randomUUID());
  await deletePayment(admin, payment.id, { reasonId: OTHER_REASON, reasonNote: "Trùng" });
  return { admin, contract, payment };
}

describe("the trash (FR-TRASH-002, D-035)", () => {
  it("lists deleted records with who, when, why, and the record as it was", async () => {
    const { admin, contract, payment } = await deletedPayment();

    const { items, total } = await listTrash(admin, {});

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      entityType: "payment",
      entityId: payment.id,
      branch: { id: DEFAULT_BRANCH_ID },
      title: `${contract.contractCode} · Nguyễn Văn An`,
      amount: 5_000_000,
      deletedBy: "ADMIN test user",
      reason: { id: OTHER_REASON, labelVi: "Khác", note: "Trùng" },
      snapshot: { id: payment.id, amount: 5_000_000, method: { labelVi: "Tiền mặt" } },
    });
    expect((await listTrash(admin, { entityType: "cash_transaction" })).total).toBe(0);
    expect((await listTrash(admin, { from: "01/01/2020", to: "31/12/2020" })).total).toBe(0);
  });

  it.each(["FITNESS_MANAGER", "ACCOUNTANT"] as const)("only management sees it: a %s is refused (09_RBAC.md)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(listTrash(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows only the viewer's branches, and hides amounts the role may not see (D-014, D-017)", async () => {
    await deletedPayment();
    const other = await createTestBranch();
    const elsewhere = await createTestUser("ADMIN", { branchIds: [other.id] });
    const { actor: masked } = await createTestUser("ADMIN", { allBranches: true, roleId: await adminCopy(["receipts.totals"]) });

    expect((await listTrash(elsewhere.actor, {})).total).toBe(0);
    const [entry] = (await listTrash(masked, {})).items;
    expect(entry.amount).toBeNull();
    expect(entry.snapshot).not.toHaveProperty("amount");
  });

  it("has no way out: the application never changes or removes an entry", async () => {
    const { admin } = await deletedPayment();
    const before = await listTrash(admin, {});

    // Recording more never touches what is already there.
    await deletedPayment();

    const after = await listTrash(admin, {});
    expect(after.items.find((item) => item.id === before.items[0].id)).toEqual(before.items[0]);
  });
});

describe("the action history (FR-PLT-008, T-048)", () => {
  it("shows each change with its values before and after, newest first, and filters by record, user, and kind", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    await updateCustomer(reception, customer.id, { fullName: "Nguyễn Văn An", phone: "0911222333" });

    const { items } = await listAuditEvents(admin, { entityId: customer.id });

    expect(items.map((item) => item.action)).toEqual(["customer.updated", "customer.created"]);
    expect(items[0]).toMatchObject({
      actor: { id: reception.id, name: "RECEPTIONIST test user" },
      entityType: "customer",
      before: { phone: "0909123456" },
      after: { phone: "0911222333" },
    });
    expect(items[1]).toMatchObject({ before: null, after: { customerCode: customer.customerCode } });
    expect((await listAuditEvents(admin, { actorUserId: admin.id })).total).toBe(0);
    expect((await listAuditEvents(admin, { entityType: "payment" })).total).toBe(0);
    expect((await listAuditEvents(admin, { from: "01/01/2020", to: "31/12/2020" })).total).toBe(0);
  });

  it("a deletion keeps the whole record as its before value, with the reason", async () => {
    const { admin, payment } = await deletedPayment();

    const [event] = (await listAuditEvents(admin, { entityId: payment.id, entityType: "payment" })).items;

    expect(event).toMatchObject({
      action: "payment.deleted",
      before: { id: payment.id, amount: 5_000_000 },
      after: null,
      context: { reason: { optionId: OTHER_REASON, note: "Trùng" } },
    });
  });

  it("hides the values a role may not see (D-017)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: masked } = await createTestUser("ADMIN", { allBranches: true, roleId: await adminCopy(["customer.phone"]) });
    const customer = await createCustomer(admin, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    await updateCustomer(admin, customer.id, { fullName: "Nguyễn Văn Ân", phone: "0911222333" });

    const [event] = (await listAuditEvents(masked, { entityId: customer.id })).items;

    expect(event.before).toEqual({ fullName: "Nguyễn Văn An" });
    expect(event.after).toEqual({ fullName: "Nguyễn Văn Ân" });
  });

  it.each(["FITNESS_MANAGER", "ACCOUNTANT", "RECEPTIONIST"] as const)("a %s is refused (09_RBAC.md)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(listAuditEvents(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/** A custom copy of the admin role with `masks` hidden; resetDatabase() removes it. */
async function adminCopy(masks: string[]): Promise<string> {
  const admin = await prisma.role.findUniqueOrThrow({ where: { id: await roleId("ADMIN") }, include: { permissions: true, dataScopes: true } });
  const copy = await prisma.role.create({
    data: {
      name: `Admin ${randomUUID().slice(0, 8)}`,
      permissions: { create: admin.permissions.map((p) => ({ permission: p.permission })) },
      dataScopes: { create: admin.dataScopes.map((s) => ({ resource: s.resource, scope: s.scope })) },
      fieldMasks: { create: masks.map((field) => ({ field })) },
    },
  });
  return copy.id;
}
