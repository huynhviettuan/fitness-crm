import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { remindOverdueApprovals } from "../../src/platform/approvals/approval.engine.js";
import { createOption, listOptions, updateOption } from "../../src/platform/options/option.service.js";
import { createCustomer, updateCustomer } from "../../src/modules/customers/customer.service.js";
import { createEmployee, getEmployee, updateEmployee } from "../../src/modules/employees/employee.service.js";
import { createLead, updateLead } from "../../src/modules/leads/lead.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

describe("the departments and job titles of the org chart (D-046)", () => {
  it("come with the migration: four departments and the titles of the chart, each with Khác", async () => {
    const departments = await listOptions("departments", {});
    const titles = await listOptions("jobTitles", {});

    expect(departments.map((o) => o.labelVi)).toEqual(["Ban điều hành", "Studio", "Marketing", "Finance", "Khác"]);
    expect(titles).toHaveLength(26);
    expect(titles.map((o) => o.labelVi)).toEqual(
      expect.arrayContaining(["CEO", "Trợ lý CEO", "Studio Manager / Master", "Coach Rookie", "Kế toán trưởng", "Kho"]),
    );
    expect(titles.at(-1)).toMatchObject({ labelVi: "Khác", isOther: true });
  });
});

describe("the number of a list entry (D-066)", () => {
  it("is optional, unique in its list, shown by the list, and audited when it changes", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const first = await createOption(admin, "needDetails", {
      labelVi: "Giảm mỡ bụng",
      labelEn: "Belly fat",
      code: "ND01",
    });
    const plain = await createOption(admin, "needDetails", { labelVi: "Tăng cơ", labelEn: "Muscle" });

    expect(first.code).toBe("ND01");
    expect(plain.code).toBeNull();
    await expect(
      createOption(admin, "needDetails", { labelVi: "Khác biệt", labelEn: "Other one", code: "nd01" }),
    ).rejects.toMatchObject({ fieldErrors: { code: ["codeAlreadyUsed"] } });
    // The same number may be used in another list.
    await expect(
      createOption(admin, "leadSources", { labelVi: "Nguồn mới", labelEn: "New source", code: "ND01" }),
    ).resolves.toMatchObject({ code: "ND01" });

    await updateOption(admin, "needDetails", plain.id, {
      labelVi: "Tăng cơ",
      labelEn: "Muscle",
      code: "ND02",
      active: true,
    });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: plain.id, action: "option.updated" } });
    expect(audit?.after).toMatchObject({ code: "ND02" });
    expect((await listOptions("needDetails", {})).map((o) => o.code)).toEqual(["ND01", "ND02", null]);
  });
});

describe("the need detail of a lead is an entry of the coded catalog, with a note (D-066)", () => {
  const channel = () => optionId("leadChannels", "WhatsApp");

  it("keeps the entry and its note, and the old free text stays as the note alone", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");
    const entry = await createOption(admin, "needDetails", {
      labelVi: "Giảm mỡ bụng",
      labelEn: "Belly fat",
      code: "ND01",
    });

    const lead = await createLead(manager, {
      fullName: "Có mã",
      channelId: await channel(),
      needDetailId: entry.id,
      needDetail: "Sau sinh 6 tháng",
    });
    const plain = await createLead(manager, {
      fullName: "Chỉ ghi chú",
      channelId: await channel(),
      needDetail: "Đau lưng",
    });

    expect(lead).toMatchObject({ needDetailOption: { id: entry.id, code: "ND01" }, needDetail: "Sau sinh 6 tháng" });
    expect(plain).toMatchObject({ needDetailOption: null, needDetail: "Đau lưng" });
  });

  it("wants the note with Khác, takes only an entry of its own list, and audits the change", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const other = await optionId("needDetails", "Khác");
    const channelId = await channel();

    await expect(createLead(manager, { fullName: "A", channelId, needDetailId: other })).rejects.toMatchObject({
      fieldErrors: { needDetail: ["otherNeedsNote"] },
    });
    await expect(
      createLead(manager, { fullName: "A", channelId, needDetailId: await optionId("leadSources", "Fanpage") }),
    ).rejects.toMatchObject({ fieldErrors: { needDetailId: ["invalidChoice"] } });

    const lead = await createLead(manager, {
      fullName: "B",
      channelId,
      needDetailId: other,
      needDetail: "Khách muốn thử yoga",
    });
    expect(lead.needDetailOption).toMatchObject({ isOther: true });
    const changed = await updateLead(manager, lead.id, {
      fullName: "B",
      channelId,
      needDetailId: "",
      needDetail: "Thôi",
    });
    expect(changed).toMatchObject({ needDetailOption: null, needDetail: "Thôi" });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.updated" } });
    expect(audit?.before).toMatchObject({ needDetailId: other });
  });
});

describe("the direct manager of an employee (D-046)", () => {
  it("is another employee, shown on the record, and audited when it changes", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const boss = await createEmployee(manager, { fullName: "Studio Manager" });

    const coach = await createEmployee(manager, { fullName: "Coach Leader", managerId: boss.id });

    expect(coach.manager).toMatchObject({ id: boss.id, fullName: "Studio Manager" });
    expect((await getEmployee(manager, coach.id)).manager?.id).toBe(boss.id);
    const moved = await updateEmployee(manager, coach.id, { fullName: "Coach Leader", managerId: "" });
    expect(moved.manager).toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: coach.id, action: "employee.updated" } });
    expect(audit).toMatchObject({ before: { managerId: boss.id }, after: { managerId: null } });
  });

  it("is never oneself, nobody who is not an employee, and never closes a loop", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const top = await createEmployee(manager, { fullName: "Trên" });
    const middle = await createEmployee(manager, { fullName: "Giữa", managerId: top.id });
    const low = await createEmployee(manager, { fullName: "Dưới", managerId: middle.id });

    await expect(updateEmployee(manager, top.id, { fullName: "Trên", managerId: top.id })).rejects.toMatchObject({
      fieldErrors: { managerId: ["managerIsSelf"] },
    });
    await expect(updateEmployee(manager, top.id, { fullName: "Trên", managerId: low.id })).rejects.toMatchObject({
      fieldErrors: { managerId: ["managerCycle"] },
    });
    await expect(
      updateEmployee(manager, top.id, { fullName: "Trên", managerId: "00000000-0000-4000-8000-0000000000aa" }),
    ).rejects.toMatchObject({ fieldErrors: { managerId: ["invalidChoice"] } });
    expect((await getEmployee(manager, top.id)).manager).toBeNull();
  });

  it("does not let two edits made at once close a loop between them", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const a = await createEmployee(manager, { fullName: "A" });
    const b = await createEmployee(manager, { fullName: "B" });

    const results = await Promise.allSettled([
      updateEmployee(manager, a.id, { fullName: "A", managerId: b.id }),
      updateEmployee(manager, b.id, { fullName: "B", managerId: a.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("a slow approval goes to the approver's direct manager, else Admin (D-048)", () => {
  async function identityEdit() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: approver } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");
    const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const { approval } = await updateCustomer(reception, customer.id, {
      fullName: "Nguyễn Văn An",
      phone: "0911222333",
    });
    const overdueAt = async () =>
      new Date(
        (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval!.id } })).submittedAt.getTime() +
          25 * 3_600_000,
      );
    return { reception, approver, admin, overdueAt };
  }
  const kindsOf = async (userId: string) =>
    (
      await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { kind: true } })
    ).map((n) => n.kind);

  it("tells the manager and not Admin when the approver has one with a login", async () => {
    const { approver, admin, reception, overdueAt } = await identityEdit();
    const { actor: boss } = await createTestUser("ACCOUNTANT");
    const bossEmployee = await createEmployee(admin, { fullName: "Sếp", userId: boss.id });
    await createEmployee(admin, { fullName: "Người duyệt", userId: approver.id, managerId: bossEmployee.id });

    await remindOverdueApprovals(await overdueAt());

    expect(await kindsOf(approver.id)).toEqual(["approvalSubmitted", "approvalOverdue"]);
    expect(await kindsOf(boss.id)).toEqual(["approvalOverdue"]);
    expect(await kindsOf(admin.id)).toEqual([]);
    expect(await kindsOf(reception.id)).toEqual([]);
  });

  it("tells Admin when the approver has no manager, or the manager has no login to tell", async () => {
    const { approver, admin, overdueAt } = await identityEdit();
    const loginless = await createEmployee(admin, { fullName: "Không tài khoản" });
    await createEmployee(admin, { fullName: "Người duyệt", userId: approver.id, managerId: loginless.id });

    await remindOverdueApprovals(await overdueAt());

    expect(await kindsOf(admin.id)).toEqual(["approvalOverdue"]);
  });

  it("tells Admin when the approver is not an employee at all, and never the submitter", async () => {
    const { admin, reception, overdueAt } = await identityEdit();

    await remindOverdueApprovals(await overdueAt());

    expect(await kindsOf(admin.id)).toEqual(["approvalOverdue"]);
    expect(await kindsOf(reception.id)).toEqual([]);
  });
});
