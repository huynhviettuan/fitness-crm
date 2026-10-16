import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@gymcrm/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { createCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import { customersExport } from "../../src/modules/customers/customer.export.js";
import { leadsExport } from "../../src/modules/leads/lead.export.js";
import { contractsExport } from "../../src/modules/contracts/contract.export.js";
import { cashExport, paymentsExport } from "../../src/modules/finance/finance.export.js";
import { tasksExport } from "../../src/modules/tasks/task.export.js";
import { createTask } from "../../src/modules/tasks/task.service.js";
import { usersExport } from "../../src/modules/users/user.export.js";
import { auditExport } from "../../src/platform/audit/audit.export.js";
import { trashExport } from "../../src/platform/trash/trash.export.js";
import { resetDatabase } from "../support/database.js";
import { activeContract } from "../support/bookings.js";
import { exportToWorkbook } from "../support/export.js";
import { actorOf, createTestBranch, createTestUser, uniquePhone } from "../support/factories.js";
import { newLead } from "../support/leads.js";

// Export to Excel (brief §1, §2, D-017, A-077 to A-080; AC-01, export part).

afterEach(resetDatabase);

const ALL = Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])) as Record<
  (typeof DATA_SCOPE_RESOURCES)[number],
  "ALL" | "OWN"
>;

/** A user whose role holds exactly these permissions and hidden fields. */
async function userWith(permissions: string[], fieldMasks: string[] = [], branchIds?: string[]) {
  const { actor: admin } = await createTestUser("ADMIN");
  const role = await createRole(admin, {
    name: `Vai trò ${randomUUID().slice(0, 8)}`,
    permissions,
    dataScopes: ALL,
    fieldMasks,
  });
  const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id, branchIds });
  return actorOf(user.id);
}

const person = (fullName: string, extra: Record<string, unknown> = {}) => ({
  fullName,
  phone: uniquePhone(),
  email: `${randomUUID().slice(0, 8)}@example.com`,
  ...extra,
});

/** `count` customers named `Khách n`, made a few at a time. */
async function customers(actor: Awaited<ReturnType<typeof actorOf>>, count: number) {
  for (let start = 0; start < count; start += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, count - start) }, (_, i) =>
        createCustomer(actor, person(`Khách ${start + i}`)),
      ),
    );
  }
}

describe("what the file holds (A-078, A-079)", () => {
  it("has a row for every customer the list counts, across pages, for the same search and filters", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await customers(manager, 125);
    const march = await createCustomer(manager, person("Sinh tháng ba", { dateOfBirth: "15/03/1990" }));

    const all = await exportToWorkbook(manager, customersExport);
    const search = await exportToWorkbook(manager, customersExport, { search: "sinh thang" });
    const month = await exportToWorkbook(manager, customersExport, { birthdayMonth: "3" });

    expect(all.rows).toHaveLength((await listCustomers(manager, {})).total);
    expect(all.rows).toHaveLength(126);
    expect(search.rows).toHaveLength(1);
    expect(month.rows.map((row) => row[1])).toEqual([march.fullName]);
    // Every row once: no row lost or repeated at a page boundary.
    expect(new Set(all.rows.map((row) => row[0])).size).toBe(126);
  });

  it("sends an .xlsx named after the list and the gym's day, one bold header row, never cached", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const { headers, sheet, header } = await exportToWorkbook(manager, customersExport);

    expect(headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(headers["content-disposition"]).toMatch(/^attachment; filename="customers-\d{8}\.xlsx"$/);
    expect(headers["cache-control"]).toBe("no-store");
    expect(sheet.name).toBe("Khách hàng");
    expect(header.slice(0, 3)).toEqual(["Mã KH", "Họ và tên", "Số điện thoại"]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("writes the headers in the user's language", async () => {
    const { actor, user } = await createTestUser("FITNESS_MANAGER");
    await prisma.user.update({ where: { id: user.id }, data: { locale: "en" } });

    const { header, sheet } = await exportToWorkbook(await actorOf(actor.id), customersExport);

    expect(sheet.name).toBe("Customers");
    expect(header.slice(0, 3)).toEqual(["Code", "Full name", "Phone"]);
  });

  it("writes dates as dates, in the gym's time, and money as numbers", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(manager, person("Ngày giờ", { dateOfBirth: "15/03/1990" }));
    // 17:30 UTC on 30 September is 00:30 on 1 October in the gym (UTC+7).
    await prisma.customer.update({ where: { id: customer.id }, data: { createdAt: new Date("2026-09-30T17:30:00Z") } });
    await activeContract(manager, customer.id);

    const customers = await exportToWorkbook(manager, customersExport, { search: "Ngày giờ" });
    const contracts = await exportToWorkbook(manager, contractsExport);

    const birth = customers.sheet.getCell(2, customers.header.indexOf("Ngày sinh") + 1);
    expect(birth.value).toEqual(new Date("1990-03-15T00:00:00Z"));
    expect(birth.numFmt).toBe("dd/mm/yyyy");
    const created = customers.sheet.getCell(2, customers.header.indexOf("Ngày tạo") + 1);
    expect(created.value).toEqual(new Date("2026-10-01T00:30:00Z"));
    expect(created.numFmt).toBe("dd/mm/yyyy hh:mm");
    const value = contracts.sheet.getCell(2, contracts.header.indexOf("Giá trị") + 1);
    expect(value.value).toBe(12_000_000);
    expect(value.numFmt).toBe("#,##0");
  });

  it("never makes a formula of a text that looks like one", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await createCustomer(manager, person('=HYPERLINK("http://evil.example","x")'));
    await createCustomer(manager, person("+1+1", { notes: "@SUM(A1)" }));

    const { sheet } = await exportToWorkbook(manager, customersExport);

    const cells = [sheet.getCell(2, 2), sheet.getCell(3, 2)];
    for (const cell of cells) {
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.formula).toBeUndefined();
    }
    expect(cells.map((cell) => cell.value).sort()).toEqual(['=HYPERLINK("http://evil.example","x")', "+1+1"].sort());
  });
});

describe("who may export, and what they get (A-077, D-017)", () => {
  it("needs the export permission of the list, in addition to seeing it", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const exportOnly = await userWith(["customer.export"]);
    const both = await userWith(["customer.view", "customer.export"]);
    const viewOnly = await userWith(["customer.view"]);

    await expect(exportToWorkbook(reception, customersExport)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportToWorkbook(viewOnly, customersExport)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportToWorkbook(exportOnly, customersExport)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportToWorkbook(both, customersExport)).resolves.toMatchObject({ rows: [] });
    expect(await prisma.auditEvent.count({ where: { action: "export.downloaded" } })).toBe(1);
  });

  it("is held by default by Admin for all nine lists and by Fitness Manager for six (A-077)", async () => {
    const holders = async (permission: string) =>
      (await prisma.rolePermission.findMany({ where: { permission }, include: { role: true } }))
        .map((holder) => holder.role.code)
        .sort();

    for (const permission of ["user.export", "audit.export", "trash.export"]) {
      expect(await holders(permission)).toEqual(["ADMIN"]);
    }
    for (const permission of [
      "customer.export",
      "lead.export",
      "contract.export",
      "payment.export",
      "cash.export",
      "task.export",
    ]) {
      expect(await holders(permission)).toEqual(["ADMIN", "FITNESS_MANAGER"]);
    }
  });

  it("leaves out the columns of fields the user cannot see, and their values", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const phone = uniquePhone();
    await createCustomer(
      manager,
      person("Có địa chỉ", {
        phone,
        email: "kin@example.com",
        address: "56 Hai Bà Trưng",
        emergencyContactName: "Lê D",
      }),
    );
    const masked = await userWith(
      ["customer.view", "customer.export"],
      ["customer.phone", "customer.email", "customer.address"],
    );

    const full = await exportToWorkbook(manager, customersExport);
    const hidden = await exportToWorkbook(masked, customersExport);

    expect(full.header).toEqual(expect.arrayContaining(["Số điện thoại", "Email", "Địa chỉ", "Liên hệ khẩn cấp"]));
    for (const column of ["Số điện thoại", "Email", "Địa chỉ", "Liên hệ khẩn cấp"]) {
      expect(hidden.header).not.toContain(column);
    }
    expect(hidden.rows).toHaveLength(1);
    expect(JSON.stringify(hidden.rows)).not.toContain(phone.slice(2));
    expect(JSON.stringify(hidden.rows)).not.toContain("kin@example.com");
    expect(JSON.stringify(hidden.rows)).not.toContain("Hai Bà Trưng");
    // The lead export follows the same masks.
    await newLead(manager, "Lead ẩn số");
    const leadsRole = await userWith(["lead.view", "lead.export"], ["customer.phone"]);
    expect((await exportToWorkbook(leadsRole, leadsExport)).header).not.toContain("Số điện thoại");
  });

  it("stays inside the user's branches, like the list", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const branch = await createTestBranch();
    await createCustomer(admin, { ...person("Chi nhánh khác"), branchId: branch.id });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await createCustomer(manager, person("Chi nhánh chính"));

    const own = await exportToWorkbook(manager, customersExport);
    const everything = await exportToWorkbook(admin, customersExport);

    expect(own.rows.map((row) => row[1])).toEqual(["Chi nhánh chính"]);
    expect(everything.rows).toHaveLength(2);
  });
});

describe("the row limit (A-078)", () => {
  const setLimit = (value: string) =>
    prisma.systemParameter.upsert({
      where: { key: "exportRowLimit" },
      create: { key: "exportRowLimit", value },
      update: { value },
    });

  it("refuses a longer list before sending anything, saying how long it is, and leaves no audit event", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await customers(manager, 4);
    await setLimit("3");

    await expect(exportToWorkbook(manager, customersExport)).rejects.toMatchObject({
      code: "EXPORT_TOO_LARGE",
      exportLimit: { limit: 3, total: 4 },
    });
    // Narrowing the filters brings it under the limit.
    await expect(exportToWorkbook(manager, customersExport, { search: "Khách 1" })).resolves.toMatchObject({
      rows: [expect.anything()],
    });
    expect(await prisma.auditEvent.count({ where: { action: "export.downloaded" } })).toBe(1);
  });

  it("holds exactly as many rows as the limit allows", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await customers(manager, 3);
    await setLimit("3");

    expect((await exportToWorkbook(manager, customersExport)).rows).toHaveLength(3);
  });

  it("defaults to 50,000 and is a system parameter an admin may change", async () => {
    const { PARAMETER_DEFAULTS } = await import("@gymcrm/shared/parameters");

    expect(PARAMETER_DEFAULTS.exportRowLimit).toBe("50000");
  });
});

describe("the audit (A-080, T-048)", () => {
  it("records who exported which list with which filters and how many rows, without the search text", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const phone = uniquePhone();
    await createCustomer(manager, person("Tìm theo số", { phone }));

    await exportToWorkbook(manager, customersExport, { search: phone, birthdayMonth: undefined, noEmail: "true" });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "export.downloaded" } });
    expect(event).toMatchObject({ actorUserId: manager.id, entityType: "export" });
    expect(event.after).toEqual({ list: "customers", filters: { search: true, noEmail: "true" }, rowCount: 0 });
    expect(JSON.stringify(event)).not.toContain(phone);
  });
});

describe("every list has an export", () => {
  it("writes a header row, and the rows of the list, for each of the nine", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(manager, person("Khách chung"));
    await activeContract(manager, customer.id);
    await newLead(manager, "Lead chung");
    await createTask(manager, {
      title: "Việc chung",
      assigneeUserId: admin.id,
      dueDate: "01/01/2030",
      dueTime: "09:00",
    });

    const sizes = {
      users: (await exportToWorkbook(admin, usersExport)).rows.length,
      customers: (await exportToWorkbook(admin, customersExport)).rows.length,
      leads: (await exportToWorkbook(admin, leadsExport)).rows.length,
      contracts: (await exportToWorkbook(admin, contractsExport)).rows.length,
      payments: (await exportToWorkbook(admin, paymentsExport)).rows.length,
      cash: (await exportToWorkbook(admin, cashExport)).rows.length,
      tasks: (await exportToWorkbook(admin, tasksExport, { view: "all" })).rows.length,
      audit: (await exportToWorkbook(admin, auditExport)).rows.length,
      trash: (await exportToWorkbook(admin, trashExport)).rows.length,
    };

    expect(sizes).toMatchObject({ customers: 1, leads: 1, contracts: 1, payments: 0, cash: 0, tasks: 1, trash: 0 });
    expect(sizes.users).toBeGreaterThanOrEqual(2);
    expect(sizes.audit).toBeGreaterThan(0);
  });

  it("refuses each list to a user who lacks its own export permission", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    for (const definition of [usersExport, auditExport, trashExport]) {
      await expect(exportToWorkbook(manager, definition as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("rejects bad filters like the list does", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(exportToWorkbook(manager, customersExport, { birthdayMonth: "13" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(exportToWorkbook(manager, leadsExport, { status: "NOPE" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
