import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { reconcile, writeReconciliation } from "../../src/import/reconcile.js";
import { assertCommitAllowed, runImport } from "../../src/import/run.js";
import { readWorkbook } from "../../src/import/workbook.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { testService } from "../support/bookings.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser } from "../support/factories.js";

afterEach(resetDatabase);

// The reconciliation of an import (M9.3; brief §11; D-039, AC-22): customers, contracts, contract value, paid and sessions left,
// the workbook against the system against the totals GymMaster shows; and no write in production without the owner's word.

async function book(totals: unknown[] | null, contractRows?: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const customers = workbook.addWorksheet("Khách hàng");
  customers.addRow(["Mã khách hàng", "Họ tên", "Số điện thoại"]);
  customers.addRow(["KH1", "Nguyễn Văn An", "0909123456"]);
  customers.addRow(["KH2", "Trần Thị Bình", "0909000111"]);
  const contracts = workbook.addWorksheet("Hợp đồng");
  contracts.addRow([
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
  ]);
  for (const row of contractRows ?? [
    ["HD1", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 4, 12_000_000, 6_000_000],
    ["HD2", "KH2", "PT 12 buổi", "PT", "01/10/2026", "01/10/2027", 12, 2, 6_000_000, 6_000_000],
  ]) {
    contracts.addRow(row);
  }
  if (totals) {
    const sheet = workbook.addWorksheet("Đối soát");
    sheet.addRow([
      "Số khách hàng",
      "Số hợp đồng",
      "Tổng giá trị hợp đồng",
      "Tổng đã thanh toán",
      "Tổng số buổi còn lại",
    ]);
    sheet.addRow(totals);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function imported(buffer: Buffer) {
  const { user } = await createTestUser("ADMIN", { allBranches: true });
  await testService();
  await runImport({ source: buffer, sourceName: "gymmaster.xlsx", userEmail: user.email, commit: true });
}

describe("the reconciliation", () => {
  it("matches when the workbook, the system and GymMaster's own totals agree (AC-22)", async () => {
    // 2 customers, 2 contracts, 18m value, 12m paid, (24-4)+(12-2) = 30 sessions left.
    const buffer = await book([2, 2, 18_000_000, 12_000_000, 30]);
    await imported(buffer);
    const result = await reconcile(prisma, await readWorkbook(buffer));
    expect(result.ok).toBe(true);
    expect(result.lines.map((line) => [line.metric, line.workbook, line.system, line.control, line.ok])).toEqual([
      ["customers", 2, 2, 2, true],
      ["contracts", 2, 2, 2, true],
      ["value", 18_000_000, 18_000_000, 18_000_000, true],
      ["paid", 12_000_000, 12_000_000, 12_000_000, true],
      ["sessionsLeft", 30, 30, 30, true],
    ]);
    expect(result.differences).toEqual([]);
    expect(result.missingCustomers).toEqual([]);
  });

  it("works without GymMaster's totals: the workbook against the system", async () => {
    const buffer = await book(null);
    await imported(buffer);
    const result = await reconcile(prisma, await readWorkbook(buffer));
    expect(result.ok).toBe(true);
    expect(result.lines.every((line) => line.control === null)).toBe(true);
  });

  it("says where GymMaster's totals differ from what was brought over", async () => {
    const buffer = await book([2, 2, 18_000_000, 12_000_000, 33]);
    await imported(buffer);
    const result = await reconcile(prisma, await readWorkbook(buffer));
    expect(result.ok).toBe(false);
    expect(result.lines.filter((line) => !line.ok).map((line) => line.metric)).toEqual(["sessionsLeft"]);
  });

  it("lists a contract that was not brought over, and one that differs from its row", async () => {
    const first = await book(null);
    await imported(first);
    // The workbook now says HD1 was paid 7m, and has a contract the first did not.
    const changed = await book(null, [
      ["HD1", "KH1", "PT 24 buổi", "PT", "01/10/2026", "01/10/2027", 24, 4, 12_000_000, 7_000_000],
      ["HD2", "KH2", "PT 12 buổi", "PT", "01/10/2026", "01/10/2027", 12, 2, 6_000_000, 6_000_000],
      ["HD3", "KH2", "PT 12 buổi", "PT", "01/10/2026", "01/10/2027", 12, 0, 6_000_000, 0],
    ]);
    const result = await reconcile(prisma, await readWorkbook(changed));
    expect(result.ok).toBe(false);
    expect(result.differences).toEqual([
      { legacyCode: "HD1", problem: "DIFFERENT", details: ["paid: 7000000 → 6000000"] },
      { legacyCode: "HD3", problem: "MISSING_IN_SYSTEM", details: [] },
    ]);
  });

  it("lists the customers of the workbook that are not in the system, and writes a report", async () => {
    const buffer = await book(null);
    const result = await reconcile(prisma, await readWorkbook(buffer));
    expect(result.ok).toBe(false);
    expect(result.missingCustomers).toEqual(["KH1", "KH2"]);
    const read = new ExcelJS.Workbook();
    await read.xlsx.load((await writeReconciliation(result)) as unknown as ArrayBuffer);
    expect(read.worksheets.map((sheet) => sheet.name)).toEqual(["Totals", "Contracts", "Customers"]);
    expect(read.getWorksheet("Totals")!.getCell("A1").value).toContain("LỆCH");
  });
});

describe("the production guard (OQ-014)", () => {
  it("refuses a real run in production unless it is confirmed, and never refuses a dry run", () => {
    expect(() => assertCommitAllowed({ commit: true, nodeEnv: "production" })).toThrow(/OQ-014/);
    expect(() => assertCommitAllowed({ commit: true, nodeEnv: "production", confirmProduction: true })).not.toThrow();
    expect(() => assertCommitAllowed({ commit: false, nodeEnv: "production" })).not.toThrow();
    expect(() => assertCommitAllowed({ commit: true, nodeEnv: "development" })).not.toThrow();
  });

  it("stops runImport before it reads anything", async () => {
    const { user } = await createTestUser("ADMIN", { allBranches: true });
    await expect(
      runImport({
        source: await book(null),
        sourceName: "x",
        userEmail: user.email,
        commit: true,
        nodeEnv: "production",
      }),
    ).rejects.toThrow(/Production import refused/);
    expect(await prisma.customer.count()).toBe(0);
  });
});
