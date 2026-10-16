import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@gymcrm/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createCustomer, getCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import {
  cancelContract,
  createContract,
  deleteContract,
  getContract,
} from "../../src/modules/contracts/contract.service.js";
import { recordCashTransaction } from "../../src/modules/finance/cash.service.js";
import { deletePayment, recordPayment, updateReceiptDate } from "../../src/modules/finance/payment.service.js";
import { createEmployee } from "../../src/modules/employees/employee.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestOption,
  createTestUser,
  optionId,
  withoutApprovals,
} from "../support/factories.js";
import { activeContract, contractInput, testSalesperson } from "../support/bookings.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

const CASH = await optionId("paymentMethods", "Tiền mặt");
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const delete_ = { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" };

async function setup() {
  const { actor: seller } = await createTestUser("FITNESS_MANAGER");
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const customer = await createCustomer(seller, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const contract = await activeContract(seller, customer.id);
  return { seller, reception, admin, customer, contract };
}

const pay = (actor: Parameters<typeof recordPayment>[0], contractId: string, extra: Record<string, unknown> = {}) =>
  recordPayment(actor, contractId, { amount: 1_000_000, methodId: CASH, paidOn: "05/10/2026", ...extra }, randomUUID());

describe("receipt numbers (D-034, D-035, D-038)", () => {
  it("numbers receipts from one series, and a deleted receipt's number is never given again", async () => {
    const { reception, admin, contract } = await setup();

    const first = (await pay(reception, contract.id)).payment;
    const second = (await pay(reception, contract.id)).payment;
    expect(first.receiptNumber).toMatch(/^PT\d{6}$/);
    expect(Number(second.receiptNumber.slice(2))).toBe(Number(first.receiptNumber.slice(2)) + 1);

    await deletePayment(admin, second.id, delete_);
    const third = (await pay(reception, contract.id)).payment;
    expect(Number(third.receiptNumber.slice(2))).toBe(Number(second.receiptNumber.slice(2)) + 1);
  });

  it("gives a receipt without a contract the same series, and an expense voucher its own", async () => {
    const { reception, admin, contract } = await setup();
    const income = await createTestOption("incomeCategories", "Bán nước");
    const expense = await createTestOption("expenseTypes", "Điện nước");

    const receipt = (await pay(reception, contract.id)).payment;
    const other = (
      await recordCashTransaction(
        admin,
        { type: "INCOME", categoryId: income, methodId: CASH, amount: "300.000", occurredOn: "04/10/2026" },
        randomUUID(),
      )
    ).transaction;
    const voucher = (
      await recordCashTransaction(
        admin,
        {
          type: "EXPENSE",
          categoryId: expense,
          methodId: CASH,
          payee: "Công ty điện lực",
          amount: "1.500.000",
          occurredOn: "04/10/2026",
        },
        randomUUID(),
      )
    ).transaction;

    expect(other.number).toMatch(/^PT\d{6}$/);
    expect(Number(other.number.slice(2))).toBe(Number(receipt.receiptNumber.slice(2)) + 1);
    expect(voucher.number).toMatch(/^PC\d{6}$/);
  });

  it("follows the prefixes admin sets, for new numbers only", async () => {
    const { reception, admin, contract } = await setup();
    const before = (await pay(reception, contract.id)).payment;

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, receiptCodePrefix: "BL" });
    const after = (await pay(reception, contract.id)).payment;

    expect(before.receiptNumber).toMatch(/^PT/);
    expect(after.receiptNumber).toMatch(/^BL\d{6}$/);
  });
});

describe("the receipt's salesperson, collector, and note (brief §8.1)", () => {
  it("defaults to the contract's Sale with the largest share, and the collector is who recorded it", async () => {
    const { reception, contract } = await setup();
    const sale = await testSalesperson();

    const { payment } = await pay(reception, contract.id, { note: "Thu tại quầy" });

    expect(payment).toMatchObject({
      saleEmployee: { id: sale.id },
      note: "Thu tại quầy",
      createdBy: expect.any(String),
    });
  });

  it("takes another active employee of the contract's branch, and refuses one elsewhere or unknown", async () => {
    const { reception, admin, contract } = await setup();
    const colleague = await createEmployee(admin, { fullName: "Sale Hai", branchId: DEFAULT_BRANCH_ID });
    const other = await createTestBranch();
    const elsewhere = await createEmployee(admin, { fullName: "Sale Xa", branchId: other.id });

    expect((await pay(reception, contract.id, { saleEmployeeId: colleague.id })).payment.saleEmployee).toMatchObject({
      id: colleague.id,
    });
    await expect(pay(reception, contract.id, { saleEmployeeId: elsewhere.id })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(pay(reception, contract.id, { saleEmployeeId: randomUUID() })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("editing a receipt's date (D-034, FR-CASH-004)", () => {
  it("is its own permission, logs the old and the new day, and refuses the future", async () => {
    const { seller, reception, admin, contract } = await setup();
    const { payment } = await pay(reception, contract.id);

    await expect(updateReceiptDate(seller, payment.id, { paidOn: "03/10/2026" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const updated = await updateReceiptDate(admin, payment.id, { paidOn: "03/10/2026" });

    expect(updated.paidOn).toEqual(new Date("2026-10-03T00:00:00.000Z"));
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: payment.id, action: "payment.date_changed" },
    });
    expect(event).toMatchObject({
      actorUserId: admin.id,
      before: { paidOn: "2026-10-05" },
      after: { paidOn: "2026-10-03" },
    });
    // The same day again records nothing.
    await updateReceiptDate(admin, payment.id, { paidOn: "03/10/2026" });
    expect(await prisma.auditEvent.count({ where: { entityId: payment.id, action: "payment.date_changed" } })).toBe(1);
    await expect(updateReceiptDate(admin, payment.id, { paidOn: "01/01/2099" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("cannot touch a deleted receipt or an unknown one", async () => {
    const { reception, admin, contract } = await setup();
    const { payment } = await pay(reception, contract.id);
    await deletePayment(admin, payment.id, delete_);

    await expect(updateReceiptDate(admin, payment.id, { paidOn: "03/10/2026" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(updateReceiptDate(admin, randomUUID(), { paidOn: "03/10/2026" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("expense vouchers (D-034, FR-CASH-002)", () => {
  let category: string;
  beforeEach(async () => {
    category = await createTestOption("expenseTypes", "Điện nước");
  });
  const voucher = async (overrides: Record<string, unknown> = {}) => ({
    type: "EXPENSE",
    categoryId: category,
    methodId: CASH,
    payee: "Công ty điện lực",
    amount: "1.500.000",
    occurredOn: "04/10/2026",
    ...overrides,
  });

  it("needs a payee and a method, and keeps both", async () => {
    const { admin } = await setup();

    await expect(recordCashTransaction(admin, await voucher({ payee: "" }), randomUUID())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { payee: ["required"] },
    });
    await expect(recordCashTransaction(admin, await voucher({ methodId: "" }), randomUUID())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const { transaction } = await recordCashTransaction(admin, await voucher(), randomUUID());
    expect(transaction).toMatchObject({ payee: "Công ty điện lực", method: { id: CASH }, contract: null });
  });

  it("links a refund to a contract of its branch, and an income cannot name a payee or a contract", async () => {
    const { admin, contract } = await setup();
    const income = await createTestOption("incomeCategories", "Bán nước");

    const { transaction } = await recordCashTransaction(
      admin,
      await voucher({ contractId: contract.id, branchId: DEFAULT_BRANCH_ID }),
      randomUUID(),
    );
    expect(transaction.contract).toMatchObject({ id: contract.id, contractCode: contract.contractCode });
    await expect(
      recordCashTransaction(admin, await voucher({ contractId: randomUUID() }), randomUUID()),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      recordCashTransaction(
        admin,
        { type: "INCOME", categoryId: income, methodId: CASH, payee: "x", amount: "1.000", occurredOn: "04/10/2026" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { payee: ["expenseOnly"] } });
  });
});

describe("derived figures and standing (brief §8.1, D-040)", () => {
  it("derives a contract's payment status from its valid receipts only", async () => {
    const { reception, admin, seller, contract } = await setup();
    expect(contract.paymentStatus).toBe("UNPAID");

    const part = (await pay(reception, contract.id, { amount: 2_000_000 })).payment;
    expect((await getContract(seller, contract.id)).paymentStatus).toBe("PARTIAL");
    await pay(reception, contract.id, { amount: 10_000_000 });
    expect((await getContract(seller, contract.id)).paymentStatus).toBe("PAID");

    await deletePayment(admin, part.id, delete_);
    expect(await getContract(seller, contract.id)).toMatchObject({ paymentStatus: "PARTIAL", debt: 2_000_000 });
  });

  it("derives a customer's standing from approved contracts", async () => {
    const { seller, admin, customer, contract } = await setup();
    const standing = async (id = customer.id) => (await getCustomer(seller, id)).contractStatus;

    // The contract runs until 2031.
    expect(await standing()).toBe("TRAINING");
    expect((await listCustomers(seller, {})).items[0].contractStatus).toBe("TRAINING");

    // A six-month contract is "expiring soon" once the window is wide enough to reach its end.
    const short = await createCustomer(seller, { fullName: "Khách Ngắn", phone: "0909000011" });
    await activeContract(seller, short.id, { contractDate: "", startDate: "" }, { months: 6 });
    expect(await standing(short.id)).toBe("TRAINING");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, expiringSoonDays: "365" });
    expect(await standing(short.id)).toBe("EXPIRING_SOON");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS });

    // Cancelled, the customer has none; a pending contract does not count.
    await cancelContract(admin, contract.id);
    await createContract(seller, customer.id, await contractInput(), randomUUID());
    expect(await standing()).toBe("NO_CONTRACT");
  });

  it("calls a customer whose approved contracts have all ended expired, and one who never had one 'no contract'", async () => {
    const { seller, customer } = await setup();
    const fresh = await createCustomer(seller, { fullName: "Khách Mới", phone: "0909000008" });
    await activeContract(
      seller,
      fresh.id,
      { contractDate: "01/01/2025", startDate: "01/01/2025", sessions: 2 },
      { months: 1 },
    );

    expect((await getCustomer(seller, fresh.id)).contractStatus).toBe("EXPIRED");
    const none = await createCustomer(seller, { fullName: "Khách Chưa", phone: "0909000010" });
    expect((await getCustomer(seller, none.id)).contractStatus).toBe("NO_CONTRACT");
    expect((await getCustomer(seller, customer.id)).contractStatus).toBe("TRAINING");
  });

  it("a deleted contract no longer counts", async () => {
    const { seller, admin, customer, contract } = await setup();

    await deleteContract(admin, contract.id, delete_);

    expect((await getCustomer(seller, customer.id)).contractStatus).toBe("NO_CONTRACT");
  });
});
