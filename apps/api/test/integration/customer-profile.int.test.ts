import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@flow/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  staffChoices,
  updateCustomer,
} from "../../src/modules/customers/customer.service.js";
import { leadChecklist } from "../../src/modules/leads/checklist.service.js";
import { leadTimeline } from "../../src/modules/leads/lead-journey.service.js";
import { resetDatabase } from "../support/database.js";
import {
  actorOf,
  createTestBranch,
  createTestOption,
  createTestUser,
  DEFAULT_BRANCH_ID,
  optionId,
  uniquePhone,
  withoutApprovals,
} from "../support/factories.js";

// The customer profile of brief §4.2 (A-069 to A-071, A-075; FR-CUS-001, FR-CUS-003, FR-CUS-005).

afterEach(resetDatabase);

const ALL = Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])) as Record<
  (typeof DATA_SCOPE_RESOURCES)[number],
  "ALL" | "OWN"
>;
const person = (fullName: string, extra: Record<string, unknown> = {}) => ({
  fullName,
  phone: uniquePhone(),
  email: `${randomUUID().slice(0, 8)}@example.com`,
  ...extra,
});
const ids = (page: { items: { id: string }[] }) => page.items.map((c) => c.id).sort();

describe("the profile (FR-CUS-001, A-069 to A-071)", () => {
  it("saves the address, emergency contact, group, and staff in charge, and audits the changes", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const group = await createTestOption("customerGroups", "Khách doanh nghiệp");

    const created = await createCustomer(reception, {
      ...person("Nguyễn Văn An"),
      address: "12 Lê Lợi, Quận 1",
      emergencyContactName: "Nguyễn Thị Hoa",
      emergencyContactPhone: "0912 345 678",
      customerGroupId: group,
      staffInChargeId: manager.id,
    });

    expect(created).toMatchObject({
      address: "12 Lê Lợi, Quận 1",
      emergencyContactName: "Nguyễn Thị Hoa",
      emergencyContactPhone: "0912345678",
      customerGroup: { id: group, labelVi: "Khách doanh nghiệp", note: null },
      staffInCharge: { id: manager.id },
    });

    await updateCustomer(reception, created.id, { address: "34 Nguyễn Huệ", staffInChargeId: "" });
    expect(await getCustomer(reception, created.id)).toMatchObject({ address: "34 Nguyễn Huệ", staffInCharge: null });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: created.id, action: "customer.updated" },
    });
    expect(audit.before).toMatchObject({ address: "12 Lê Lợi, Quận 1", picUserId: manager.id });
    expect(audit.after).toMatchObject({ address: "34 Nguyễn Huệ", picUserId: null });
  });

  it('needs a note with the group "Khác" and refuses a group of another list', async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    const other = await optionId("customerGroups", "Khác");

    await expect(createCustomer(actor, person("A", { customerGroupId: other }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { customerGroupNote: ["otherNeedsNote"] },
    });
    await expect(
      createCustomer(actor, person("B", { customerGroupId: await optionId("leadChannels", "Zalo") })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { customerGroupId: ["invalidChoice"] } });
    const created = await createCustomer(
      actor,
      person("C", { customerGroupId: other, customerGroupNote: "Hội viên cũ" }),
    );
    expect(created.customerGroup).toMatchObject({ isOther: true, note: "Hội viên cũ" });
  });

  it("puts only an active user of the customer's branch in charge", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const branch = await createTestBranch();
    const { user: elsewhere } = await createTestUser("CONSULTING", { branchIds: [branch.id] });
    const { user: disabled } = await createTestUser("CONSULTING");
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    const customer = await createCustomer(reception, person("Trần Thị Bình"));

    for (const userId of [elsewhere.id, disabled.id, randomUUID()]) {
      await expect(updateCustomer(reception, customer.id, { staffInChargeId: userId })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: { staffInChargeId: ["invalidChoice"] },
      });
    }
    expect((await getCustomer(reception, customer.id)).staffInCharge).toBeNull();
  });

  it("hides the address and emergency contact together from a role with the field hidden, and keeps them unchanged", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const customer = await createCustomer(
      reception,
      person("Lê Văn Cường", {
        address: "56 Hai Bà Trưng",
        emergencyContactName: "Lê Thị D",
        emergencyContactPhone: "0911222333",
      }),
    );
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: `Vai trò ${randomUUID().slice(0, 8)}`,
      permissions: ["customer.view", "customer.manage"],
      dataScopes: ALL,
      fieldMasks: ["customer.address"],
    });
    const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id });
    const masked = await actorOf(user.id);

    expect(await getCustomer(masked, customer.id)).toMatchObject({
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      maskedFields: ["address"],
    });
    await updateCustomer(masked, customer.id, { address: "Chỗ khác", emergencyContactName: "X", notes: "Đã gọi" });

    expect(await getCustomer(reception, customer.id)).toMatchObject({
      address: "56 Hai Bà Trưng",
      emergencyContactName: "Lê Thị D",
      notes: "Đã gọi",
    });
  });

  it("rejects text with control characters and a phone that is not one", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(
      createCustomer(actor, person("A", { address: "bad\u0000", emergencyContactPhone: "abc" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { address: ["invalidCharacters"], emergencyContactPhone: ["invalidPhone"] },
    });
  });
});

describe("the filters (FR-CUS-003, FR-CUS-005, A-075)", () => {
  it("narrows by branch, staff in charge, registration days, birthday month, and no email", async () => {
    await withoutApprovals();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const branch = await createTestBranch();
    const march = await createCustomer(
      reception,
      person("Sinh tháng ba", { dateOfBirth: "15/03/1990", staffInChargeId: consultant.id }),
    );
    const june = await createCustomer(reception, person("Sinh tháng sáu", { dateOfBirth: "02/06/1985" }));
    const noEmail = await createCustomer(reception, { ...person("Không email"), email: "" });
    const elsewhere = await createCustomer(admin, { ...person("Chi nhánh khác"), branchId: branch.id });
    // Registered on known days (gym time).
    await prisma.customer.update({ where: { id: march.id }, data: { createdAt: new Date("2026-09-10T05:00:00Z") } });
    await prisma.customer.update({ where: { id: june.id }, data: { createdAt: new Date("2026-09-30T17:30:00Z") } });

    expect(ids(await listCustomers(admin, {}))).toEqual([march.id, june.id, noEmail.id, elsewhere.id].sort());
    expect(ids(await listCustomers(admin, { branchId: branch.id }))).toEqual([elsewhere.id]);
    expect(ids(await listCustomers(admin, { branchId: DEFAULT_BRANCH_ID }))).toEqual(
      [march.id, june.id, noEmail.id].sort(),
    );
    expect(ids(await listCustomers(admin, { staffId: consultant.id }))).toEqual([march.id]);
    expect(ids(await listCustomers(admin, { birthdayMonth: "3" }))).toEqual([march.id]);
    expect(ids(await listCustomers(admin, { birthdayMonth: "6" }))).toEqual([june.id]);
    expect(ids(await listCustomers(admin, { noEmail: "true" }))).toEqual([noEmail.id]);
    // 30/09 17:30 UTC is already 01/10 (00:30) in the gym: the day filters follow the gym's days.
    expect(ids(await listCustomers(admin, { registeredFrom: "10/09/2026", registeredTo: "10/09/2026" }))).toEqual([
      march.id,
    ]);
    expect(ids(await listCustomers(admin, { registeredFrom: "01/10/2026", registeredTo: "01/10/2026" }))).toEqual([
      june.id,
    ]);
    expect(ids(await listCustomers(admin, { registeredTo: "09/09/2026" }))).toEqual([]);
  });

  it("combines the filters with the search and with paging", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    for (let i = 0; i < 5; i++) await createCustomer(actor, person(`Khách ${i}`, { dateOfBirth: "01/07/1990" }));
    await createCustomer(actor, person("Khác tháng", { dateOfBirth: "01/08/1990" }));

    const page = await listCustomers(actor, { birthdayMonth: "7", q: "khach", page: "2", pageSize: "2" });

    expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(2);
  });

  it("rejects a month or a day that is not one", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(listCustomers(actor, { birthdayMonth: "13" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { birthdayMonth: ["invalidChoice"] },
    });
    await expect(listCustomers(actor, { registeredFrom: "31/02/2026" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(listCustomers(actor, { staffId: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("does not tell a user who cannot see emails which customers have none", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await createCustomer(reception, { ...person("Không email"), email: "" });
    await createCustomer(reception, person("Có email"));
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: `Vai trò ${randomUUID().slice(0, 8)}`,
      permissions: ["customer.view"],
      dataScopes: ALL,
      fieldMasks: ["customer.email"],
    });
    const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id });

    const page = await listCustomers(await actorOf(user.id), { noEmail: "true" });

    expect(page.total).toBe(2);
  });

  it("keeps the filters inside the user's branches", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const branch = await createTestBranch();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await createCustomer(admin, { ...person("Chi nhánh khác"), branchId: branch.id });

    expect((await listCustomers(reception, { branchId: branch.id })).total).toBe(0);
  });
});

describe("who can be in charge (A-071)", () => {
  it("lists the active users of the user's branches, by name", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST", { name: "Bình" });
    await createTestUser("CONSULTING", { name: "An" });
    const { user: disabled } = await createTestUser("CONSULTING", { name: "Cường" });
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    const branch = await createTestBranch();
    await createTestUser("CONSULTING", { name: "Dung", branchIds: [branch.id] });
    await createTestUser("ADMIN", { name: "Ê", allBranches: true });

    const staff = await staffChoices(reception);

    expect(staff.map((person) => person.name)).toEqual(["An", "Bình", "Ê"]);
  });

  it("is for someone who can see customers", async () => {
    const { actor } = await createTestUser("MARKETING");

    await expect(staffChoices(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a customer who never was a lead (A-076)", () => {
  it("has an empty consulting history and checklist", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    const customer = await createCustomer(actor, person("Khách trực tiếp"));

    expect((await leadTimeline(actor, customer.id)).items).toEqual([]);
    expect((await leadChecklist(actor, customer.id)).items).toEqual([]);
  });
});
