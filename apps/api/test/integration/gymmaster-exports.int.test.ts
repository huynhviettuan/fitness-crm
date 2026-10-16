import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { createEmployee } from "../../src/modules/employees/employee.service.js";
import { runImport } from "../../src/import/run.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { testService } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestUser } from "../support/factories.js";

afterEach(resetDatabase);

// GymMaster's own exports (M9.2b; brief §11; D-039, D-011, D-021; A-301 to A-305): one file per report, each with a tab
// called "Worksheet", in GymMaster's column names. The people here are made up; the headers are GymMaster's.

const MEMBERS = [
  "STT",
  "Mã HV",
  "Họ",
  "Tên đệm",
  "Họ tên hội viên",
  "Mã vân tay",
  "Ngày sinh",
  "SĐT",
  "Email",
  "Chi nhánh",
];
const CONTRACTS = [
  "STT",
  "Mã HV",
  "Họ tên hội viên",
  "Ngày sinh",
  "SĐT",
  "Chi nhánh",
  "Mã HĐ",
  "Ngày HĐ",
  "Dịch vụ - gói thẻ",
  "Loại HĐ",
  "Trạng thái",
  "Đơn giá",
  "Tổng tiền",
  "Chiết khấu tiền",
  "Tổng thanh toán",
  "Đã thanh toán",
  "Còn nợ",
  "Số buổi thẻ gạch",
  "Số buổi đã tập",
  "Số buổi còn lại",
  "Ngày bắt đầu tập",
  "Ngày hết hạn tập",
  "Nhân viên PT",
  "Nhân viên Sale",
  "Số buổi KM",
  "Duyệt HĐ?",
];
const BOOKINGS = [
  "STT",
  "Mã học viên",
  "Tên học viên",
  "SĐT",
  "Ngày",
  "Giờ vào",
  "Giờ ra",
  "Trạng thái",
  "HLV",
  "Mã HLV",
];

async function file(headers: string[], rows: unknown[][], title?: string) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Worksheet");
  if (title) {
    sheet.addRow([title]);
    sheet.addRow([]);
  }
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** One contract row in the export's order. */
function contract(patch: Partial<Record<(typeof CONTRACTS)[number], unknown>>): unknown[] {
  const row: Record<string, unknown> = {
    STT: 1,
    "Mã HV": "HV0001",
    "Họ tên hội viên": "Khách Một",
    "Ngày sinh": "30/11/-0001",
    SĐT: "0909000001",
    "Chi nhánh": "Chi nhánh tổng",
    "Mã HĐ": "HP000001",
    "Ngày HĐ": "05/10/2026",
    "Dịch vụ - gói thẻ": "Hybrid Training 12 buổi",
    "Loại HĐ": "Renew",
    "Trạng thái": "Còn hạn",
    "Đơn giá": 600_000,
    "Tổng tiền": 7_200_000,
    "Chiết khấu tiền": 0,
    "Tổng thanh toán": 7_200_000,
    "Đã thanh toán": 7_200_000,
    "Còn nợ": "",
    "Số buổi thẻ gạch": 12,
    "Số buổi đã tập": 3,
    "Số buổi còn lại": 9,
    "Ngày bắt đầu tập": "05/10/2026",
    "Ngày hết hạn tập": "04/01/2027",
    "Nhân viên PT": "Huấn Luyện A (100%)",
    "Nhân viên Sale": "Bán Hàng B (100%)",
    "Số buổi KM": "",
    "Duyệt HĐ?": "Đã duyệt",
    ...patch,
  };
  return CONTRACTS.map((header) => row[header]);
}

async function world() {
  const { user, actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  await testService(3, 600_000, "Hybrid Training");
  await createEmployee(admin, { fullName: "Huấn Luyện A", branchId: DEFAULT_BRANCH_ID });
  await createEmployee(admin, { fullName: "Bán Hàng B", branchId: DEFAULT_BRANCH_ID });
  return { email: user.email };
}

async function exports(contracts: unknown[][], members: unknown[][] = []) {
  return [
    { name: "Thông tin hội viên.xlsx", data: await file(MEMBERS, members) },
    { name: "Danh sách hợp đồng.xlsx", data: await file(CONTRACTS, contracts) },
    { name: "Báo cáo booking.xlsx", data: await file(BOOKINGS, [[1, "HV0001", "Khách Một"]], "Báo cáo booking") },
  ];
}

const run = async (source: Awaited<ReturnType<typeof exports>>, commit: boolean) =>
  runImport({ source, sourceName: "gymmaster exports", userEmail: (await world()).email, commit });

describe("GymMaster's exports, as they come (A-301)", () => {
  it("are told apart by their headers, the report saying what each file was taken for", async () => {
    const { plan } = await run(
      await exports([contract({})], [[1, "HV0001", "", "", "Khách Một", 1, "", "0909000001", ""]]),
      false,
    );
    expect(plan.files.map((use) => [use.file, use.usedAs])).toEqual([
      ["Thông tin hội viên.xlsx", "customers"],
      ["Danh sách hợp đồng.xlsx", "contracts"],
      ["Báo cáo booking.xlsx", null],
    ]);
    expect(plan.sheetIssues).toEqual([]);
    expect(plan.contracts[0]!.entry.file).toBe("Danh sách hợp đồng.xlsx");
  });

  it("make a member the members' file lacks from the contract that names them, once", async () => {
    const { plan } = await run(
      await exports([contract({}), contract({ "Mã HĐ": "HP000002", "Ngày HĐ": "06/10/2026" })]),
      false,
    );
    expect(plan.customers.map((item) => [item.entry.legacyCode, item.entry.action, item.input.fullName])).toEqual([
      ["HV0001", "CREATE", "Khách Một"],
    ]);
    // GymMaster's "no birth date" is not a wrong date.
    expect(plan.customers[0]!.entry.issues).toEqual([]);
  });
});

describe("a contract of the export (A-302 to A-305)", () => {
  it("is imported with the amount after discount, the bonus sessions, its type, and its PT and Sale with their shares", async () => {
    const source = await exports([
      contract({
        "Tổng tiền": 8_000_000,
        "Chiết khấu tiền": 800_000,
        "Tổng thanh toán": 7_200_000,
        "Đã thanh toán": 5_000_000,
        "Còn nợ": 2_200_000,
        "Số buổi KM": 2,
        "Số buổi đã tập": 4,
        "Số buổi còn lại": 10,
        "Ngày HĐ": "05/10/2026 00:00:00",
      }),
    ]);
    const { plan, applied } = await run(source, true);
    expect(plan.contracts[0]!.cleanup).toEqual([]);
    expect(applied?.contracts).toEqual({ created: 1, failed: [] });

    const saved = await prisma.contract.findFirstOrThrow({
      where: { legacyCode: "HP000001" },
      include: { shares: { include: { employee: { select: { fullName: true } } } } },
    });
    expect(saved).toMatchObject({
      contractType: "RENEW",
      totalSessions: 12,
      bonusSessions: 2,
      openingSessionsUsed: 4,
      status: "ACTIVE",
      isImported: true,
    });
    expect([Number(saved.contractValue), Number(saved.openingPaidAmount)]).toEqual([7_200_000, 5_000_000]);
    expect(saved.shares.map((share) => [share.role, share.employee.fullName, Number(share.percent)]).sort()).toEqual([
      ["PT", "Huấn Luyện A", 100],
      ["SALE", "Bán Hàng B", 100],
    ]);
  });

  it("takes the sessions used from the sessions left when GymMaster leaves them empty", async () => {
    const { plan } = await run(await exports([contract({ "Số buổi đã tập": "", "Số buổi còn lại": 12 })]), false);
    expect(plan.contracts[0]).toMatchObject({ sessionsUsed: 0, cleanup: [] });
    const { plan: used } = await run(await exports([contract({ "Số buổi đã tập": "", "Số buổi còn lại": 7 })]), false);
    expect(used.contracts[0]).toMatchObject({ sessionsUsed: 5, cleanup: [] });
  });

  it("is listed for the owner when GymMaster's own figures disagree, it was not approved there, or its staff are unknown", async () => {
    const { plan } = await run(
      await exports([
        contract({ "Mã HĐ": "HP1", "Số buổi đã tập": 3, "Số buổi còn lại": 5 }),
        contract({ "Mã HĐ": "HP2", "Đã thanh toán": 5_000_000, "Còn nợ": 1_000_000 }),
        contract({ "Mã HĐ": "HP3", "Duyệt HĐ?": "Chưa duyệt" }),
        contract({ "Mã HĐ": "HP4", "Nhân viên PT": "Người Lạ (100%)" }),
        contract({ "Mã HĐ": "HP5", "Dịch vụ - gói thẻ": "Hybrid Training 48 buổi" }),
      ]),
      false,
    );
    const reasons = Object.fromEntries(plan.contracts.map((item) => [item.entry.legacyCode, item.cleanup]));
    expect(reasons).toEqual({
      HP1: ["SESSIONS_LEFT_DIFFER"],
      HP2: ["DEBT_DIFFERS"],
      HP3: ["NOT_APPROVED_IN_SOURCE"],
      HP4: ["STAFF_NOT_FOUND"],
      HP5: ["SESSIONS_DIFFER_FROM_NAME"],
    });
  });

  it("with a member who has no phone is left out with the reason, and so is the member", async () => {
    const { plan } = await run(await exports([contract({ SĐT: "" })]), false);
    expect(plan.customers[0]).toMatchObject({ entry: { action: "REJECT" } });
    expect(plan.contracts[0]).toMatchObject({
      entry: { action: "REJECT", issues: ["customerLegacyCode:unknownCustomer"] },
    });
  });

  it("names an unknown staff name only on the cleanup list, and is imported without that share", async () => {
    const { applied } = await run(await exports([contract({ "Nhân viên PT": "Người Lạ (100%)" })]), true);
    expect(applied?.contracts.created).toBe(1);
    const shares = await prisma.contractStaffShare.findMany({ select: { role: true } });
    expect(shares).toEqual([{ role: "SALE" }]);
  });
});
