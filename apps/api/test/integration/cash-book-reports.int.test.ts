import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@gymcrm/shared/parameters";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { env } from "../../src/platform/env.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { activateContract } from "../../src/modules/contracts/contract-approval.service.js";
import { createContract, deleteContract } from "../../src/modules/contracts/contract.service.js";
import { deleteCashTransaction, recordCashTransaction } from "../../src/modules/finance/cash.service.js";
import { listDebts, recordPayment } from "../../src/modules/finance/payment.service.js";
import {
  cashBook,
  incomeExpense,
  listCashOpenings,
  setCashOpening,
} from "../../src/modules/reports/cash-book.service.js";
import { contractReport, exceptionPriceReport } from "../../src/modules/reports/contract-report.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestOption,
  createTestUser,
  optionId,
  withoutApprovals,
} from "../support/factories.js";
import { activeContract, contractInput } from "../support/bookings.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

const CASH = await optionId("paymentMethods", "Tiền mặt");
const TRANSFER = await optionId("paymentMethods", "Chuyển khoản");
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const PERIOD = { from: "01/10/2026", to: "10/10/2026" };

const key = () => randomUUID();

async function setup() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: seller } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(seller, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const income = await createTestOption("incomeCategories", "Bán nước");
  const expense = await createTestOption("expenseTypes", "Điện nước");
  return { admin, seller, customer, income, expense };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const income = (actor: Setup["admin"], categoryId: string, amount: string, occurredOn: string, methodId = CASH) =>
  recordCashTransaction(actor, { type: "INCOME", categoryId, methodId, amount, occurredOn }, key());

const expense = (actor: Setup["admin"], categoryId: string, amount: string, occurredOn: string, methodId = CASH) =>
  recordCashTransaction(
    actor,
    { type: "EXPENSE", categoryId, methodId, payee: "Công ty điện lực", amount, occurredOn },
    key(),
  );

const pay = (actor: Setup["admin"], contractId: string, amount: number, paidOn: string, methodId = CASH) =>
  recordPayment(actor, contractId, { amount, methodId, paidOn }, key());

describe("the cash book (FR-CASH-005, AC-19)", () => {
  async function books() {
    const world = await setup();
    const { admin, seller, customer } = world;
    const contract = await activeContract(seller, customer.id);
    await setCashOpening(admin, {
      branchId: DEFAULT_BRANCH_ID,
      methodId: CASH,
      effectiveOn: "01/09/2026",
      amount: 5_000_000,
    });
    await income(admin, world.income, "400.000", "28/09/2026");
    await pay(admin, contract.id, 1_000_000, "02/10/2026");
    await income(admin, world.income, "300.000", "02/10/2026");
    await expense(admin, world.expense, "200.000", "04/10/2026");
    await pay(admin, contract.id, 500_000, "04/10/2026", TRANSFER);
    return { ...world, contract };
  }

  it("closes at opening + in - out for each method, and the days chain into the same closing (AC-19)", async () => {
    const { admin } = await books();

    const book = await cashBook(admin, PERIOD);

    const byMethod = (label: string) => book.rows.find((row) => row.method.labelVi === label)!;
    expect(byMethod("Tiền mặt")).toMatchObject({
      opening: 5_400_000,
      inflow: 1_300_000,
      outflow: 200_000,
      closing: 6_500_000,
    });
    expect(byMethod("Chuyển khoản")).toMatchObject({ opening: 0, inflow: 500_000, outflow: 0, closing: 500_000 });
    expect(book.totals).toEqual({ opening: 5_400_000, inflow: 1_800_000, outflow: 200_000, closing: 7_000_000 });
    for (const row of book.rows) expect(row.closing).toBe(row.opening + row.inflow - row.outflow);

    expect(book.days).toHaveLength(10);
    expect(book.days[0]!.opening).toBe(book.totals.opening);
    expect(book.days.at(-1)!.closing).toBe(book.totals.closing);
    book.days.slice(1).forEach((day, index) => expect(day.opening).toBe(book.days[index]!.closing));
    expect(book.days[1]).toMatchObject({ inflow: 1_300_000, outflow: 0 });
    expect(book.days[3]).toMatchObject({ inflow: 500_000, outflow: 200_000 });
  });

  it("splits a period at any day: the second half opens where the first closed", async () => {
    const { admin } = await books();

    const first = await cashBook(admin, { from: "01/10/2026", to: "03/10/2026" });
    const second = await cashBook(admin, { from: "04/10/2026", to: "10/10/2026" });

    expect(second.totals.opening).toBe(first.totals.closing);
    expect(second.totals.closing).toBe((await cashBook(admin, PERIOD)).totals.closing);
  });

  it("leaves out pending, rejected, and deleted vouchers and receipts (D-018, D-035)", async () => {
    const { admin, seller, income: category, contract } = await books();
    const before = (await cashBook(admin, PERIOD)).totals;

    const pending = (await income(admin, category, "999.999", "03/10/2026")).transaction;
    await prisma.cashTransaction.update({ where: { id: pending.id }, data: { approvalStatus: "PENDING" } });
    const rejected = (await pay(seller, contract.id, 123_000, "03/10/2026")).payment;
    await prisma.payment.update({ where: { id: rejected.id }, data: { approvalStatus: "REJECTED" } });
    const deleted = (await income(admin, category, "111.111", "03/10/2026")).transaction;
    await deleteCashTransaction(admin, deleted.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });

    expect((await cashBook(admin, PERIOD)).totals).toEqual(before);
  });

  it("counts from the day the books begin: earlier movements and a branch without an opening are handled", async () => {
    const { admin, income: category } = await books();
    await income(admin, category, "50.000", "20/08/2026");

    const book = await cashBook(admin, PERIOD);

    // The opening was set effective 01/09, so August's movement is not part of the cash in the books.
    expect(book.totals.opening).toBe(5_400_000);
    const other = await createTestBranch();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { branchIds: [other.id] });
    await income(manager, category, "70.000", "05/10/2026");
    const both = await cashBook(admin, PERIOD);
    expect([...new Set(both.rows.map((row) => row.branch.id))].sort()).toEqual([DEFAULT_BRANCH_ID, other.id].sort());
    expect(both.totals.inflow).toBe(1_800_000 + 70_000);
  });

  it("shows each user only their branches, and refuses a branch they do not work in", async () => {
    const { admin, income: category } = await books();
    const other = await createTestBranch();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { branchIds: [other.id] });
    await income(manager, category, "70.000", "05/10/2026");

    const mine = await cashBook(manager, PERIOD);
    expect([...new Set(mine.rows.map((row) => row.branch.id))]).toEqual([other.id]);
    expect(mine.totals).toMatchObject({ opening: 0, inflow: 70_000, closing: 70_000 });
    await expect(cashBook(manager, { ...PERIOD, branchId: DEFAULT_BRANCH_ID })).rejects.toMatchObject({
      fieldErrors: { branchId: ["invalidChoice"] },
    });
    expect((await cashBook(admin, { ...PERIOD, branchId: other.id })).totals.inflow).toBe(70_000);
  });

  it("needs the permission, and refuses a period that ends before it starts or is too long", async () => {
    const { admin } = await books();
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    await expect(cashBook(reception, PERIOD)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cashBook(admin, { from: "10/10/2026", to: "01/10/2026" })).rejects.toMatchObject({
      fieldErrors: { to: ["endBeforeStart"] },
    });
    await expect(cashBook(admin, { from: "01/01/2000", to: "10/10/2026" })).rejects.toMatchObject({
      fieldErrors: { to: ["periodTooLong"] },
    });
  });
});

describe("the opening balance (A-138)", () => {
  it("is set by Admin only, replaced in place, and audited with before and after", async () => {
    const { admin, seller } = await setup();
    const input = { branchId: DEFAULT_BRANCH_ID, methodId: CASH, effectiveOn: "01/09/2026", amount: 5_000_000 };

    await expect(setCashOpening(seller, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setCashOpening(admin, input);
    await setCashOpening(admin, { ...input, amount: 6_000_000 });

    const { items } = await listCashOpenings(admin);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: 6_000_000, method: { labelVi: "Tiền mặt" } });
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "cash_opening_balance" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual(["cash_opening.set", "cash_opening.updated"]);
    expect(events[1]).toMatchObject({ before: { amount: 5_000_000 }, after: { amount: 6_000_000 } });
  });

  it("takes a payment method and a branch of the actor, never another list's option or a negative amount", async () => {
    const { admin, income: category } = await setup();
    const input = { branchId: DEFAULT_BRANCH_ID, methodId: CASH, effectiveOn: "01/09/2026", amount: 1 };

    await expect(setCashOpening(admin, { ...input, methodId: category })).rejects.toMatchObject({
      fieldErrors: { methodId: ["invalidChoice"] },
    });
    await expect(
      setCashOpening(admin, { ...input, methodId: await optionId("paymentMethods", "Khác") }),
    ).rejects.toMatchObject({
      fieldErrors: { methodId: ["invalidChoice"] },
    });
    await expect(setCashOpening(admin, { ...input, amount: "-5" })).rejects.toMatchObject({
      fieldErrors: { amount: ["invalidAmount"] },
    });
  });
});

describe("the income and expense report (A-139)", () => {
  it("lists contract payments, other income and expenses by category, and nets them", async () => {
    const { admin, seller, customer, income: category, expense: type } = await setup();
    const contract = await activeContract(seller, customer.id);
    await pay(admin, contract.id, 1_000_000, "02/10/2026");
    await pay(admin, contract.id, 500_000, "04/10/2026", TRANSFER);
    await income(admin, category, "300.000", "02/10/2026");
    await expense(admin, type, "200.000", "04/10/2026");
    await expense(admin, type, "100.000", "05/10/2026");
    await expense(admin, type, "7.000", "20/09/2026");

    const report = await incomeExpense(admin, PERIOD);

    expect(report.lines).toEqual([
      { kind: "CONTRACT_PAYMENT", category: null, count: 2, amount: 1_500_000 },
      { kind: "EXPENSE", category: expect.objectContaining({ labelVi: "Điện nước" }), count: 2, amount: 300_000 },
      { kind: "INCOME", category: expect.objectContaining({ labelVi: "Bán nước" }), count: 1, amount: 300_000 },
    ]);
    expect(report).toMatchObject({ income: 1_800_000, expense: 300_000, net: 1_500_000 });
    // The cash book counts the same money (AC-19).
    expect((await cashBook(admin, PERIOD)).totals).toMatchObject({ inflow: 1_800_000, outflow: 300_000 });
  });
});

describe("the contract report (brief §9, A-140)", () => {
  async function sold() {
    const world = await setup();
    const { admin, seller, customer } = world;
    const first = await activeContract(seller, customer.id);
    const { contract: renewal } = await createContract(
      seller,
      customer.id,
      await contractInput({ contractType: "RENEW", previousContractId: first.id, contractDate: "03/10/2026" }),
      key(),
    );
    await activateContract(admin, renewal.id);
    await pay(admin, first.id, 4_000_000, "02/10/2026");
    return { ...world, first, renewal };
  }

  it("counts new and renewed approved contracts, their value, the receipts of the period, and the debt, by service and band", async () => {
    const { admin } = await sold();

    const report = await contractReport(admin, PERIOD);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      service: { name: "PT" },
      band: { min: 1, max: 1000 },
      newContracts: 1,
      renewedContracts: 1,
      value: 24_000_000,
      revenue: 4_000_000,
      debt: 20_000_000,
    });
    expect(report.totals).toMatchObject({ newContracts: 1, renewedContracts: 1, revenue: 4_000_000 });
  });

  it("leaves out drafts, rejected and deleted contracts, and receipts outside the period", async () => {
    const { admin, seller, customer, first } = await sold();
    await createContract(seller, customer.id, await contractInput({ contractDate: "05/10/2026" }), key());
    const doomed = await activeContract(seller, customer.id);
    await deleteContract(admin, doomed.id, { reasonId: OTHER_DELETE, reasonNote: "Tạo nhầm" });
    await pay(admin, first.id, 1_000_000, "09/10/2026");

    const inPeriod = await contractReport(admin, PERIOD);
    const before = await contractReport(admin, { from: "01/09/2026", to: "30/09/2026" });

    expect(inPeriod.totals).toMatchObject({ newContracts: 1, renewedContracts: 1, revenue: 5_000_000 });
    expect(before.rows).toEqual([]);
    expect((await contractReport(admin, { from: "03/10/2026", to: "03/10/2026" })).totals.revenue).toBe(0);
  });

  it("counts running contracts that end soon or have few sessions left, by the parameters", async () => {
    const { admin, first } = await sold();
    const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
    const soon = new Date(today.getTime() + 5 * 86_400_000);
    await prisma.contract.update({ where: { id: first.id }, data: { endDate: soon } });

    const defaults = await contractReport(admin, PERIOD);
    expect(defaults.totals).toMatchObject({ expiringSoon: 1, runningOut: 0 });

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, runningOutSessions: "24", expiringSoonDays: "3" });
    const changed = await contractReport(admin, PERIOD);
    expect(changed.totals).toMatchObject({ expiringSoon: 0, runningOut: 2 });
  });

  it("is the permission's, over the whole scope, and within the actor's branches", async () => {
    const { admin } = await sold();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const other = await createTestBranch();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { branchIds: [other.id] });

    await expect(contractReport(reception, PERIOD)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await contractReport(manager, PERIOD)).rows).toEqual([]);
    expect((await contractReport(admin, { ...PERIOD, branchId: other.id })).rows).toEqual([]);
  });
});

describe("the exception-price report (brief §9, BR-302, A-141)", () => {
  it("gives the share of exception prices and their cost against the tier price, by creator and approver", async () => {
    const { admin, seller, customer } = await setup();
    const reason = await optionId("exceptionPriceReasons", "Khác");
    const { contract: plain } = await createContract(seller, customer.id, await contractInput(), key());
    const { contract: special } = await createContract(
      seller,
      customer.id,
      await contractInput({
        proposedUnitPrice: "400.000",
        exceptionReasonId: reason,
        exceptionNote: "Khách thân thiết",
      }),
      key(),
    );
    await activateContract(admin, plain.id);
    await activateContract(admin, special.id);

    const report = await exceptionPriceReport(admin, PERIOD);

    // Tier 500,000 less 400,000, over 24 sessions.
    expect(report.totals).toEqual({ contracts: 2, exceptions: 1, share: 50, difference: 2_400_000 });
    expect(report.byCreator).toEqual([
      {
        user: { id: expect.any(String), name: "FITNESS_MANAGER test user" },
        contracts: 2,
        exceptions: 1,
        share: 50,
        difference: 2_400_000,
      },
    ]);
    expect(report.byApprover).toEqual([
      {
        user: { id: expect.any(String), name: "ADMIN test user" },
        contracts: 2,
        exceptions: 1,
        share: 50,
        difference: 2_400_000,
      },
    ]);
  });

  it("ignores contracts that are not approved, and refuses a role without the permission", async () => {
    const { admin, seller, customer } = await setup();
    await createContract(seller, customer.id, await contractInput(), key());
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    expect((await exceptionPriceReport(admin, PERIOD)).totals.contracts).toBe(0);
    await expect(exceptionPriceReport(reception, PERIOD)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the member debt list (brief §9)", () => {
  it("leaves out a deleted contract", async () => {
    const { admin, seller, customer } = await setup();
    const kept = await activeContract(seller, customer.id);
    const doomed = await activeContract(seller, customer.id);
    await deleteContract(admin, doomed.id, { reasonId: OTHER_DELETE, reasonNote: "Tạo nhầm" });

    const debts = await listDebts(admin, {});

    expect(debts.total).toBe(1);
    expect(debts.items.map((item) => item.id)).toEqual([kept.id]);
  });
});
