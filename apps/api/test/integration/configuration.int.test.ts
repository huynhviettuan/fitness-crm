import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { createOption, listOptions, otherNotes, reorderOptions, updateOption } from "../../src/platform/options/option.service.js";
import { readParameters, updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { deletePayment, recordPayment } from "../../src/modules/finance/payment.service.js";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals } from "../support/factories.js";
import { activeContract } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});
// These tests are about something else than approvals (approvals.int.test.ts).
beforeEach(async () => {
  await withoutApprovals();
});


const labels = (options: { labelVi: string }[]) => options.map((option) => option.labelVi);

describe("option lists (FR-PLT-005, D-016)", () => {
  it("lists active options in order with Khác last; inactive ones only on request", async () => {
    expect(labels(await listOptions("paymentMethods", {}))).toEqual(["Tiền mặt", "Chuyển khoản", "Thẻ", "Khác"]);
    expect(labels(await listOptions("paymentMethods", { includeInactive: "true" }))).toEqual([
      "Tiền mặt",
      "Chuyển khoản",
      "Thẻ",
      "Ví điện tử",
      "Khác",
    ]);
    await expect(listOptions("nope", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an admin adds an option at the end (before Khác), and the change is audited", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const option = await createOption(admin, "expenseTypes", { labelVi: "Tiền điện", labelEn: "Electricity" });

    expect(option).toMatchObject({ listKey: "expenseTypes", active: true, isOther: false, sortOrder: 1 });
    expect(labels(await listOptions("expenseTypes", {}))).toEqual(["Tiền điện", "Khác"]);
    expect(await prisma.auditEvent.findFirst({ where: { entityId: option.id } })).toMatchObject({ action: "option.created" });
    await expect(createOption(admin, "expenseTypes", { labelVi: "TIỀN ĐIỆN", labelEn: "x" })).rejects.toMatchObject({
      fieldErrors: { labelVi: ["nameAlreadyUsed"] },
    });
  });

  it("renames and deactivates an option with before and after in the audit; Khác stays active", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const card = await optionId("paymentMethods", "Thẻ");

    const after = await updateOption(admin, "paymentMethods", card, { labelVi: "Quẹt thẻ", labelEn: "Card", active: false });

    expect(after).toMatchObject({ labelVi: "Quẹt thẻ", active: false });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: card, action: "option.updated" } })).toMatchObject({
      before: { labelVi: "Thẻ", active: true },
      after: { labelVi: "Quẹt thẻ", active: false },
    });
    await expect(
      updateOption(admin, "paymentMethods", await optionId("paymentMethods", "Khác"), { labelVi: "Khác", labelEn: "Other", active: false }),
    ).rejects.toMatchObject({ fieldErrors: { active: ["otherAlwaysActive"] } });
    // An option of another list is not found through this one.
    await expect(updateOption(admin, "deleteReasons", card, { labelVi: "Thẻ", labelEn: "Card" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reorders every option but Khác, and refuses a partial order", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const ids = await Promise.all(["Thẻ", "Tiền mặt", "Ví điện tử", "Chuyển khoản"].map((label) => optionId("paymentMethods", label)));

    const list = await reorderOptions(admin, "paymentMethods", { optionIds: ids });

    expect(labels(list)).toEqual(["Thẻ", "Tiền mặt", "Ví điện tử", "Chuyển khoản", "Khác"]);
    await expect(reorderOptions(admin, "paymentMethods", { optionIds: ids.slice(1) })).rejects.toMatchObject({
      fieldErrors: { optionIds: ["invalidChoice"] },
    });
  });

  it("collects the notes written with Khác, most used first, for admin to promote", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(manager, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const contract = await activeContract(manager, customer.id);
    const other = await optionId("paymentMethods", "Khác");
    for (const note of ["Ví MoMo", " ví momo ", "ZaloPay"]) {
      await recordPayment(manager, contract.id, { amount: 1, methodId: other, methodNote: note, paidOn: "05/10/2026" }, randomUUID());
    }
    const { payment } = await recordPayment(manager, contract.id, { amount: 1, methodId: other, methodNote: "Séc", paidOn: "05/10/2026" }, randomUUID());
    await deletePayment(admin, payment.id, { reasonId: await optionId("deleteReasons", "Khác"), reasonNote: "Nhập trùng" });

    const notes = await otherNotes(admin, "paymentMethods");

    expect(notes.map(({ note, count }) => ({ note, count }))).toEqual([
      { note: expect.stringMatching(/^ví momo$/i), count: 2 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
    expect((await otherNotes(admin, "deleteReasons")).map((n) => n.note)).toEqual(["Nhập trùng"]);
  });

  it.each(["FITNESS_MANAGER", "RECEPTIONIST"] as const)("a %s reads the lists but cannot change them (09_RBAC.md)", async (role) => {
    const { actor } = await createTestUser(role);
    const card = await optionId("paymentMethods", "Thẻ");

    await expect(listOptions("paymentMethods", {})).resolves.toHaveLength(4);
    await expect(createOption(actor, "paymentMethods", { labelVi: "x", labelEn: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOption(actor, "paymentMethods", card, { labelVi: "x", labelEn: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reorderOptions(actor, "paymentMethods", { optionIds: [card] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(otherNotes(actor, "paymentMethods")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the database keeps one Khác per list, always active", async () => {
    await expect(
      prisma.option.create({ data: { listKey: "paymentMethods", labelVi: "Khác 2", labelEn: "Other 2", sortOrder: 9, isOther: true } }),
    ).rejects.toThrow();
    await expect(prisma.option.updateMany({ where: { listKey: "paymentMethods", isOther: true }, data: { active: false } })).rejects.toThrow(
      /options_other_always_active/,
    );
  });
});

describe("system parameters (FR-PLT-006, T-049)", () => {
  it("start with the brief's initial values", async () => {
    expect(await readParameters()).toEqual(PARAMETER_DEFAULTS);
  });

  it("an admin changes them; each changed value is audited, and refusals name the field", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const after = await updateParameters(admin, { ...PARAMETER_DEFAULTS, calendarDayStart: "05:30" });

    expect(after.calendarDayStart).toBe("05:30");
    const audits = await prisma.auditEvent.findMany({ where: { action: "parameter.updated" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ before: { calendarDayStart: "05:00" }, after: { calendarDayStart: "05:30" } });
    await expect(updateParameters(admin, { ...PARAMETER_DEFAULTS, calendarDayEnd: "04:00" })).rejects.toMatchObject({
      fieldErrors: { calendarDayEnd: ["endTimeNotAfterStart"] },
    });
  });

  it("refuses anyone without configuration permission", async () => {
    const { actor } = await createTestUser("FITNESS_MANAGER");

    await expect(updateParameters(actor, PARAMETER_DEFAULTS)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("new codes take a changed prefix at once, and their numbers keep counting (D-038)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const before = await createCustomer(admin, { fullName: "Trước", phone: "0909000001" });

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, customerCodePrefix: "hv" });
    const after = await createCustomer(admin, { fullName: "Sau", phone: "0909000002" });

    expect(before.customerCode).toMatch(/^KH\d{6,}$/);
    expect(after.customerCode).toMatch(/^HV\d{6,}$/);
    expect(Number(after.customerCode.slice(2))).toBeGreaterThan(Number(before.customerCode.slice(2)));
  });
});
