// D-014, D-017, T-046: configurable roles, data scope, field masking, and branches.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@flow/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { cloneRole, createRole, getRole, listRoles, updateRole } from "../../src/platform/roles/role.service.js";
import { createBranch, listBranches, updateBranch } from "../../src/platform/branches/branch.service.js";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../../src/modules/customers/customer.service.js";
import { createContract, listContracts } from "../../src/modules/contracts/contract.service.js";
import { activateContract } from "../../src/modules/contracts/contract-approval.service.js";
import { createEmployee } from "../../src/modules/employees/employee.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { listBookings } from "../../src/modules/bookings/booking.service.js";
import { collectedBetween, listPayments, recordPayment } from "../../src/modules/finance/payment.service.js";
import { financeSummary } from "../../src/modules/finance/cash.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  actorOf,
  createTestBranch,
  createTestUser,
  optionId,
  withoutApprovals,
  uniquePhone,
} from "../support/factories.js";
import { activeContract, book, bookingScenario, contractInput, linkedTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

const ALL = Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])) as Record<
  (typeof DATA_SCOPE_RESOURCES)[number],
  "ALL" | "OWN"
>;

/** A custom role, and a user holding it. */
async function userWithRole(input: { permissions: string[]; dataScopes?: Partial<typeof ALL>; fieldMasks?: string[] }) {
  const { actor: admin } = await createTestUser("ADMIN");
  const role = await createRole(admin, {
    name: `Vai trò ${randomUUID().slice(0, 8)}`,
    permissions: input.permissions,
    dataScopes: { ...ALL, ...input.dataScopes },
    fieldMasks: input.fieldMasks ?? [],
  });
  const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id });
  return { admin, role, actor: await actorOf(user.id) };
}

describe("roles (FR-PLT-002)", () => {
  it("lists the default roles of 09_RBAC.md with their configuration", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const roles = await listRoles(admin);

    expect(
      roles
        .map((r) => r.code)
        .filter(Boolean)
        .sort(),
    ).toEqual(["ACCOUNTANT", "ADMIN", "CONSULTING", "FITNESS_MANAGER", "MARKETING", "MASTER", "PT", "RECEPTIONIST"]);
    const pt = roles.find((r) => r.code === "PT")!;
    expect(pt.dataScopes).toEqual({
      customers: "OWN",
      contracts: "OWN",
      schedule: "OWN",
      vouchers: "OWN",
      staff: "OWN",
      tasks: "OWN",
      leads: "OWN",
    });
    expect(roles.find((r) => r.code === "MARKETING")!.fieldMasks).toEqual([
      "customer.email",
      "customer.health",
      "customer.idDocument",
      "customer.phone",
    ]);
    // D-042, A-060: a PT sees health notes, to train safely, but not ID documents.
    expect(roles.find((r) => r.code === "PT")!.fieldMasks).toEqual(["customer.idDocument"]);
  });

  it("a change to a role applies to its users on their next request (AC-02), and is audited", async () => {
    const { admin, role, actor } = await userWithRole({ permissions: ["customer.view"] });
    await expect(createCustomer(actor, { fullName: "A", phone: "0909000001" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await updateRole(admin, role.id, {
      name: role.name,
      permissions: ["customer.view", "customer.manage"],
      dataScopes: ALL,
      fieldMasks: [],
    });

    await expect(
      createCustomer(await actorOf(actor.id), { fullName: "A", phone: "0909000001" }),
    ).resolves.toBeDefined();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: role.id, action: "role.updated" } });
    expect(audit).toMatchObject({
      before: { permissions: ["customer.view"] },
      after: { permissions: ["customer.manage", "customer.view"] },
    });
  });

  it("a clone copies permissions, scopes, and masks under a new name", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const marketing = (await listRoles(admin)).find((r) => r.code === "MARKETING")!;

    const copy = await cloneRole(admin, marketing.id, { name: "Marketing chi nhánh 2" });

    expect(copy).toMatchObject({
      code: null,
      name: "Marketing chi nhánh 2",
      fieldMasks: marketing.fieldMasks,
      dataScopes: marketing.dataScopes,
    });
    await expect(cloneRole(admin, marketing.id, { name: "Marketing chi nhánh 2" })).rejects.toMatchObject({
      fieldErrors: { name: ["nameAlreadyUsed"] },
    });
  });

  it("an admin cannot take user or role management away from their own role", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const own = await getRole(admin, admin.roleId);

    await expect(
      updateRole(admin, own.id, { ...own, permissions: own.permissions.filter((p) => p !== "role.manage") }),
    ).rejects.toMatchObject({
      code: "CANNOT_CHANGE_OWN_ACCESS",
    });
  });

  it("only users with role management can change roles", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(listRoles(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createRole(manager, { name: "X", permissions: [], dataScopes: ALL, fieldMasks: [] }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
// These tests are about something else than approvals (approvals.int.test.ts).
beforeEach(async () => {
  await withoutApprovals();
});

describe("data scope (D-017, A-029)", () => {
  it("with own customers, a user sees the ones they created and the ones they train", async () => {
    const scenario = await bookingScenario();
    const { actor: consultant } = await createTestUser("CONSULTING");
    const mine = await createCustomer(consultant, { fullName: "Khách của tôi", phone: "0909000002" });

    expect((await listCustomers(consultant, {})).items.map((c) => c.id)).toEqual([mine.id]);
    await expect(getCustomer(consultant, scenario.customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { actor: pt, trainer } = await linkedTrainer(scenario.manager);
    expect((await listCustomers(pt, {})).total).toBe(0);
    await book(scenario.manager, scenario, {}, trainer.id);
    expect((await listCustomers(pt, {})).items.map((c) => c.id)).toEqual([scenario.customer.id]);
  });

  it("with own contracts, a user sees the contracts they created or of their own customers", async () => {
    const scenario = await bookingScenario();
    const { actor: consultant } = await createTestUser("CONSULTING");
    const mine = await createCustomer(consultant, { fullName: "Khách của tôi", phone: "0909000003" });
    const { contract } = await createContract(consultant, mine.id, await contractInput(), randomUUID());

    expect((await listContracts(consultant, {})).items.map((c) => c.id)).toEqual([contract.id]);
    // Not even for a customer they cannot see.
    await expect(
      createContract(consultant, scenario.customer.id, await contractInput(), randomUUID()),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("with own schedule, a PT sees only their own sessions", async () => {
    const scenario = await bookingScenario();
    const { actor: pt, trainer } = await linkedTrainer(scenario.manager);
    const theirs = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" }, trainer.id);
    await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });

    expect((await listBookings(pt, {})).items.map((b) => b.id)).toEqual([theirs.id]);
  });

  it("with own vouchers, a user sees and totals only the payments they recorded", async () => {
    const scenario = await bookingScenario();
    const { actor: consultant } = await createTestUser("CONSULTING");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const mine = await createCustomer(consultant, { fullName: "Khách của tôi", phone: "0909000004" });
    const contract = await activeContract(scenario.manager, mine.id);
    const pay = async (actor: typeof reception, amount: number) =>
      recordPayment(
        actor,
        contract.id,
        { amount, methodId: await optionId("paymentMethods", "Tiền mặt"), paidOn: "05/10/2026" },
        randomUUID(),
      );
    const { payment } = await pay(consultant, 1_000_000);
    await pay(reception, 2_000_000);

    expect((await listPayments(consultant, {})).items.map((p) => p.id)).toEqual([payment.id]);
    expect(await collectedBetween(consultant, { from: "01/10/2026", to: "31/10/2026" })).toBe(1_000_000);
    expect(await collectedBetween(reception, { from: "01/10/2026", to: "31/10/2026" })).toBe(3_000_000);
  });
});

describe("field masking (D-017, AC-01)", () => {
  it("a hidden phone and email come back empty, are listed as hidden, and cannot be searched or changed", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const customer = await createCustomer(reception, {
      fullName: "Trần Bí Mật",
      phone: "0909555666",
      email: "bi.mat@example.com",
    });
    const { actor } = await userWithRole({
      permissions: ["customer.view", "customer.manage"],
      fieldMasks: ["customer.phone", "customer.email"],
    });

    expect(await getCustomer(actor, customer.id)).toMatchObject({
      phone: null,
      email: null,
      maskedFields: ["phone", "email"],
    });
    expect((await listCustomers(actor, { q: "0909555666" })).total).toBe(0);
    expect((await listCustomers(actor, { q: "bi mat" })).items[0]).toMatchObject({ phone: null });

    await updateCustomer(actor, customer.id, { phone: "0909000000", notes: "Đã gọi" });
    expect(await getCustomer(reception, customer.id)).toMatchObject({
      phone: "0909555666",
      notes: "Đã gọi",
      maskedFields: [],
    });
  });

  it("hidden receipt totals come back empty", async () => {
    const { actor } = await userWithRole({
      permissions: ["payment.view", "cash.manage"],
      fieldMasks: ["receipts.totals"],
    });

    expect(await collectedBetween(actor, { from: "01/10/2026", to: "31/10/2026" })).toBeNull();
    expect(await financeSummary(actor, { from: "01/10/2026", to: "31/10/2026" })).toEqual({
      contractPayments: null,
      otherIncome: null,
      expense: null,
    });
  });

  it("hidden receipt totals and phones leave the contract list's totals and phone empty (D-017)", async () => {
    const { actor: seller } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(seller, { fullName: "Khách", phone: "0909000009" });
    await createContract(seller, customer.id, await contractInput(), randomUUID());
    const { actor } = await userWithRole({
      permissions: ["contract.view"],
      fieldMasks: ["receipts.totals", "customer.phone"],
    });

    const page = await listContracts(actor, {});

    expect(page.totals).toBeNull();
    expect(page.items[0]).toMatchObject({ customerPhone: null });
  });
});

describe("branches (D-014, FR-PLT-004)", () => {
  it("a new record goes to the chosen branch, which must be one of the user's active branches", async () => {
    const second = await createTestBranch();
    const elsewhere = await createTestBranch();
    const { actor } = await createTestUser("RECEPTIONIST", { branchIds: [DEFAULT_BRANCH_ID, second.id] });
    const customer = { fullName: "Khách", phone: "0909000005" };

    await expect(createCustomer(actor, customer)).rejects.toMatchObject({ fieldErrors: { branchId: ["required"] } });
    await expect(createCustomer(actor, { ...customer, branchId: elsewhere.id })).rejects.toMatchObject({
      fieldErrors: { branchId: ["invalidChoice"] },
    });
    expect((await createCustomer(actor, { ...customer, branchId: second.id })).branch).toEqual(second);

    await prisma.branch.update({ where: { id: second.id }, data: { active: false } });
    await expect(createCustomer(actor, { ...customer, branchId: second.id })).rejects.toMatchObject({
      fieldErrors: { branchId: ["invalidChoice"] },
    });
    // With one active branch left, it is chosen for them.
    expect((await createCustomer(actor, { ...customer, phone: uniquePhone() })).branch.id).toBe(DEFAULT_BRANCH_ID);
  });

  it("contracts take their customer's branch", async () => {
    const second = await createTestBranch();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { branchIds: [second.id] });
    const customer = await createCustomer(manager, { fullName: "Khách", phone: "0909000006" });

    // The service and the salesperson are the second branch's own (A-115).
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const service = await createService(admin, { name: "PT Q2", kind: "MEMBER", branchIds: [second.id] });
    await saveTiers(admin, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 500_000, validityMonths: 3, validityDays: 0 }],
    });
    const sale = await createEmployee(admin, { fullName: "Bán hàng Q2", branchId: second.id });
    const { contract: created } = await createContract(
      manager,
      customer.id,
      { serviceId: service.id, sessions: 10, saleShares: [{ employeeId: sale.id, percent: 100 }] },
      randomUUID(),
    );
    const contract = await activateContract((await createTestUser("ADMIN", { allBranches: true })).actor, created.id);

    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).branchId).toBe(second.id);
  });

  it("admin creates, renames, and deactivates branches; names are unique", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const branch = await createBranch(admin, { name: "Flow Quận 7", address: "12 Nguyễn Thị Thập" });
    expect(await updateBranch(admin, branch.id, { name: "Flow Q7", address: "", active: false })).toMatchObject({
      name: "Flow Q7",
      address: null,
      active: false,
    });
    await expect(createBranch(admin, { name: "Flow Q7" })).rejects.toMatchObject({
      fieldErrors: { name: ["nameAlreadyUsed"] },
    });
    await expect(listBranches(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
