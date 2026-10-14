import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { runImport } from "../../src/import/run.js";
import { readWorkbook, writeTemplate } from "../../src/import/workbook.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { testService } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestUser } from "../support/factories.js";

afterEach(resetDatabase);

// The GymMaster import (M9.2; brief §11; D-039, D-011, FR-IMP-001; A-249 to A-255): a workbook of customers, staff and
// contracts is checked row by row, written only on request, and can be run again without doubling anything.

const CUSTOMER_HEADERS = ["Mã khách hàng", "Họ tên", "Số điện thoại", "Email", "Ngày sinh"];
const CONTRACT_HEADERS = [
  "Mã hợp đồng",
  "Mã khách hàng",
  "Tên gói",
  "Dịch vụ",
  "Ngày bắt đầu",
  "Ngày hết hạn",
  "Số buổi",
  "Số buổi đã dùng",
  "Giá trị hợp đồng",
  "Đã thanh toán",
];
const STAFF_HEADERS = ["Mã nhân viên", "Họ tên", "Số điện thoại", "PT"];

async function book(sheets: {
  customers?: unknown[][];
  contracts?: unknown[][];
  staff?: unknown[][];
  other?: unknown[][];
}) {
  const workbook = new ExcelJS.Workbook();
  if (sheets.customers) {
    const sheet = workbook.addWorksheet("Khách hàng");
    sheet.addRow(CUSTOMER_HEADERS);
    sheets.customers.forEach((row) => sheet.addRow(row));
  }
  if (sheets.contracts) {
    const sheet = workbook.addWorksheet("Hợp đồng");
    sheet.addRow(CONTRACT_HEADERS);
    sheets.contracts.forEach((row) => sheet.addRow(row));
  }
  if (sheets.staff) {
    const sheet = workbook.addWorksheet("Nhân viên");
    sheet.addRow(STAFF_HEADERS);
    sheets.staff.forEach((row) => sheet.addRow(row));
  }
  if (sheets.other) workbook.addWorksheet("Ghi chú").addRow(["bỏ qua"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function world() {
  const { user, actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const service = await testService();
  return { admin, email: user.email, service };
}

const run = (w: Awaited<ReturnType<typeof world>>, source: Buffer, commit: boolean) =>
  runImport({ source, sourceName: "gymmaster.xlsx", userEmail: w.email, commit });

describe("the import workbook", () => {
  it("has a blank template that reads back with every column known", async () => {
    const parsed = await readWorkbook(await writeTemplate());
    expect(parsed.ignoredSheets).toEqual([]);
    for (const sheet of ["customers", "contracts", "staff"] as const) {
      expect(parsed[sheet]?.missing, sheet).toEqual([]);
      expect(parsed[sheet]?.rows, sheet).toEqual([]);
    }
  });
});

describe("a dry run", () => {
  it("checks every row, lists what needs the owner, and writes nothing", async () => {
    const w = await world();
    const source = await book({
      customers: [
        ["KH1", "Nguyễn Văn An", "0909 123 456", "an@example.com", "01/02/1990"],
        ["KH2", "Trần Thị Bình", "0909000111", "", ""],
        ["KH3", "Không số", "", "", ""],
        ["KH4", "Trùng số", "0909123456", "", ""],
      ],
      staff: [["NV1", "PT Minh", "0912345678", "x"]],
      contracts: [
        // Agrees with its name and tier: 24 sessions at 500,000.
        ["HD1", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 4, 12_000_000, 6_000_000],
        // 24 recorded as 30: the owner confirms.
        ["HD2", "KH2", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 30, 0, 15_000_000, 15_000_000],
        // A price that is not the tier's.
        ["HD3", "KH2", "PT 12 buổi", "PT", "01/10/2026", "01/10/2027", 12, 0, 4_800_000, 0],
        // A service nobody has.
        ["HD4", "KH1", "Yoga 10 buổi", "Yoga", "01/10/2026", "01/10/2027", 10, 0, 2_000_000, 0],
        // Rejected: used above sessions, a customer nobody knows, a day that is not one.
        ["HD5", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 30, 12_000_000, 0],
        ["HD6", "KH9", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 0, 12_000_000, 0],
        ["HD7", "KH1", "PT 24 buổi", "PT", "31/02/2026", "01/10/2027", 24, 0, 12_000_000, 0],
      ],
      other: [[]],
    });
    const { plan, applied, runId, report } = await run(w, source, false);

    expect(applied).toBeNull();
    expect(runId).toBeNull();
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.contract.count()).toBe(0);
    expect(plan.ignoredSheets).toEqual(["Ghi chú"]);

    const customers = Object.fromEntries(plan.customers.map((item) => [item.entry.legacyCode, item.entry]));
    expect(customers.KH1!.action).toBe("CREATE");
    expect(customers.KH2!.action).toBe("CREATE");
    expect(customers.KH3).toMatchObject({ action: "REJECT" });
    expect(customers.KH3!.issues.join()).toContain("phone");
    // The same phone as KH1 in the same file: one person, one record (D-019).
    expect(customers.KH4).toMatchObject({ action: "DUPLICATE", issues: ["phone:sameAs:KH1"] });

    const contracts = Object.fromEntries(plan.contracts.map((item) => [item.entry.legacyCode, item]));
    expect(contracts.HD1).toMatchObject({ newName: "PT 24 buổi", cleanup: [] });
    expect(contracts.HD1!.entry.action).toBe("CREATE");
    expect(contracts.HD2!.cleanup).toEqual(["SESSIONS_DIFFER_FROM_NAME"]);
    expect(contracts.HD2!.newName).toBe("PT 30 buổi");
    expect(contracts.HD3!.cleanup).toEqual(["PRICE_DIFFERS_FROM_TIER"]);
    expect(contracts.HD4!.cleanup).toEqual(["NO_SERVICE"]);
    expect(contracts.HD5!.entry).toMatchObject({ action: "REJECT", issues: ["sessionsUsed:aboveSessions"] });
    expect(contracts.HD6!.entry.issues).toEqual(["customerLegacyCode:unknownCustomer"]);
    expect(contracts.HD7!.entry.issues).toContain("startDate:invalidDate");

    // The report for the owner: the cleanup list names the three contracts to confirm, and what was left out is there.
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(report as unknown as ArrayBuffer);
    expect(read.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Cleanup", "Left out"]);
    const listed = (sheetName: string, column = 1) =>
      read
        .getWorksheet(sheetName)!
        .getSheetValues()
        .slice(2)
        .map((row) => (row as unknown[])[column]);
    expect(listed("Cleanup")).toEqual(["HD2", "HD3", "HD4"]);
    expect(listed("Left out", 3)).toEqual(expect.arrayContaining(["KH3", "KH4", "HD5", "HD6", "HD7"]));
  });

  it("says which required columns a tab lacks, and leaves its rows alone", async () => {
    const w = await world();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Customers");
    sheet.addRow(["Họ tên", "Ghi chú"]);
    sheet.addRow(["Nguyễn Văn An", "x"]);
    const { plan } = await run(w, Buffer.from(await workbook.xlsx.writeBuffer()), false);
    expect(plan.sheetIssues).toEqual([{ sheet: "customers", code: "missingColumns", fields: ["legacyCode", "phone"] }]);
    expect(plan.unknownColumns).toEqual([{ sheet: "customers", headers: ["Ghi chú"] }]);
    expect(plan.customers).toEqual([]);
  });
});

describe("a real run", () => {
  const rows = {
    customers: [["KH1", "Nguyễn Văn An", "0909123456", "an@example.com", "01/02/1990"]],
    staff: [["NV1", "PT Minh", "0912345678", "x"]],
    contracts: [
      ["HD1", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 4, 12_000_000, 6_000_000],
      ["HD2", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 30, 10, 15_000_000, 15_000_000],
    ],
  };

  it("brings the records over with their legacy codes and opening balances, and lists the cleanup", async () => {
    const w = await world();
    const { plan, applied, runId } = await run(w, await book(rows), true);

    expect(applied).toMatchObject({
      customers: { created: 1, failed: [] },
      staff: { created: 1, failed: [] },
      contracts: { created: 2, failed: [] },
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { legacyCode: "KH1" } });
    expect(customer).toMatchObject({ fullName: "Nguyễn Văn An", customerCode: expect.any(String) });
    expect(await prisma.employee.findUniqueOrThrow({ where: { legacyCode: "NV1" } })).toMatchObject({
      fullName: "PT Minh",
    });

    // The opening balances carry what GymMaster says; the figures of the system derive from them (D-011, T-050).
    const first = await prisma.contract.findUniqueOrThrow({ where: { legacyCode: "HD1" } });
    expect(first).toMatchObject({
      isImported: true,
      status: "ACTIVE",
      customerId: customer.id,
      serviceId: w.service.id,
      totalSessions: 24,
      openingSessionsUsed: 4,
      packageName: "PT 24 buổi",
    });
    expect(Number(first.openingPaidAmount)).toBe(6_000_000);
    expect(first.contractCode).not.toBe("HD1");
    expect(await getContract(w.admin, first.id)).toMatchObject({
      remainingSessions: 20,
      contractValue: 12_000_000,
      paidAmount: 6_000_000,
      debt: 6_000_000,
    });

    // 24 recorded as 30 is renamed by its real session count and is on the owner's list.
    const second = await prisma.contract.findUniqueOrThrow({ where: { legacyCode: "HD2" } });
    expect(second.packageName).toBe("PT 30 buổi");
    expect(second.notes).toContain("GymMaster: PT 24 buổi");
    expect(plan.contracts.find((item) => item.entry.legacyCode === "HD2")!.cleanup).toEqual([
      "SESSIONS_DIFFER_FROM_NAME",
    ]);

    const record = await prisma.importRun.findUniqueOrThrow({ where: { id: runId! } });
    expect(record.source).toBe("gymmaster.xlsx");
    expect(record.cleanup).toEqual([{ legacyCode: "HD2", reasons: ["SESSIONS_DIFFER_FROM_NAME"] }]);
    expect(await prisma.auditEvent.count({ where: { action: "import.completed", entityId: runId! } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "contract.imported" } })).toBe(2);
  });

  it("is run again without doubling anything: what was brought over is skipped by its legacy code", async () => {
    const w = await world();
    await run(w, await book(rows), true);
    const again = await run(w, await book(rows), true);
    expect(again.applied).toMatchObject({
      customers: { created: 0 },
      staff: { created: 0 },
      contracts: { created: 0 },
    });
    expect(again.plan.customers[0]!.entry.action).toBe("ALREADY_IMPORTED");
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.contract.count()).toBe(2);
    expect(await prisma.importRun.count()).toBe(2);
  });

  it("does not create a person who already has the phone: one person, one record (D-019)", async () => {
    const w = await world();
    const { user } = await createTestUser("RECEPTIONIST");
    const existing = await prisma.customer.create({
      data: {
        branchId: DEFAULT_BRANCH_ID,
        customerCode: "KH-OLD",
        fullName: "Có sẵn",
        searchName: "co san",
        phone: "0909123456",
        createdById: user.id,
      },
    });
    const { plan, applied } = await run(w, await book({ customers: rows.customers }), true);
    expect(plan.customers[0]!.entry).toMatchObject({ action: "DUPLICATE", issues: ["phone:sameAs:KH-OLD"] });
    expect(applied!.customers.created).toBe(0);
    expect(await prisma.customer.count({ where: { phone: existing.phone } })).toBe(1);
  });

  it("is for an Admin of every branch, and needs a branch when there are several", async () => {
    const w = await world();
    const { user: manager } = await createTestUser("FITNESS_MANAGER");
    await expect(
      runImport({ source: await book(rows), sourceName: "x", userEmail: manager.email, commit: false }),
    ).rejects.toThrow(/Admin/);
    await expect(
      runImport({ source: await book(rows), sourceName: "x", userEmail: "nobody@example.com", commit: false }),
    ).rejects.toThrow(/No user/);
    await prisma.branch.create({ data: { name: "Chi nhánh 2" } });
    await expect(run(w, await book(rows), false)).rejects.toThrow(/branch/);
  });
});
