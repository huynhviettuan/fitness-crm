import ExcelJS from "exceljs";
import { parseWhole } from "@flow/shared/import";
import type { Db } from "../platform/db/prisma.js";
import type { ParsedWorkbook } from "./workbook.js";

// The reconciliation of an import (brief §11, D-039, AC-22; M9.3): the totals of customers, contracts, contract value, paid and
// sessions left, three ways: what the workbook says, what the system holds for the records brought over, and, when the sheet is
// given, the totals GymMaster itself shows. The cut-over waits until every line agrees.

export const METRICS = ["customers", "contracts", "value", "paid", "sessionsLeft"] as const;
export type Metric = (typeof METRICS)[number];
export type Totals = Record<Metric, number>;

export type Line = {
  metric: Metric;
  workbook: number;
  system: number;
  /** The total GymMaster shows; null when no control sheet was given. */
  control: number | null;
  ok: boolean;
};

export type ContractDifference = {
  legacyCode: string;
  problem: "MISSING_IN_SYSTEM" | "DIFFERENT";
  /** `field: workbook value → system value`. */
  details: string[];
};

export type Reconciliation = {
  lines: Line[];
  differences: ContractDifference[];
  /** Customers of the workbook that are not in the system. */
  missingCustomers: string[];
  ok: boolean;
};

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());

/** The totals the workbook's rows add up to (a row that is not a number counts as nothing; the dry run rejects such rows). */
export function workbookTotals(workbook: ParsedWorkbook): Totals {
  const customers = new Set((workbook.customers?.rows ?? []).map((row) => text(row.cells.legacyCode)).filter(Boolean));
  const contracts = workbook.contracts?.rows ?? [];
  const sum = (field: string) => contracts.reduce((total, row) => total + (parseWhole(row.cells[field]) ?? 0), 0);
  return {
    customers: customers.size,
    contracts: new Set(contracts.map((row) => text(row.cells.legacyCode)).filter(Boolean)).size,
    value: sum("value"),
    paid: sum("paid"),
    sessionsLeft: sum("sessions") - sum("sessionsUsed"),
  };
}

/** The control totals from the "totals" tab, one row under its headers; null when there is none. */
export function controlTotals(workbook: ParsedWorkbook): Totals | null {
  const row = workbook.totals?.rows[0];
  if (!row) return null;
  return Object.fromEntries(METRICS.map((metric) => [metric, parseWhole(row.cells[metric]) ?? 0])) as Totals;
}

/** What the system holds for the records that came over, as they were brought over (the opening balances, D-011). */
export async function systemTotals(db: Db): Promise<Totals> {
  const [customers, contracts, sums] = await Promise.all([
    db.customer.count({ where: { legacyCode: { not: null } } }),
    db.contract.count({ where: { legacyCode: { not: null }, deletedAt: null } }),
    db.$queryRaw<{ value: bigint | null; paid: bigint | null; left: bigint | null }[]>`
      SELECT SUM(contract_value)::bigint AS value, SUM(opening_paid_amount)::bigint AS paid,
             SUM(total_sessions - opening_sessions_used)::bigint AS "left"
      FROM contracts WHERE legacy_code IS NOT NULL AND deleted_at IS NULL`,
  ]);
  return {
    customers,
    contracts,
    value: Number(sums[0]?.value ?? 0),
    paid: Number(sums[0]?.paid ?? 0),
    sessionsLeft: Number(sums[0]?.left ?? 0),
  };
}

export async function reconcile(db: Db, workbook: ParsedWorkbook): Promise<Reconciliation> {
  const expected = workbookTotals(workbook);
  const control = controlTotals(workbook);
  const actual = await systemTotals(db);
  const lines: Line[] = METRICS.map((metric) => ({
    metric,
    workbook: expected[metric],
    system: actual[metric],
    control: control ? control[metric] : null,
    ok: expected[metric] === actual[metric] && (control === null || control[metric] === actual[metric]),
  }));

  // Contract by contract: what the workbook says against what was brought over.
  const stored = await db.contract.findMany({
    where: { legacyCode: { not: null }, deletedAt: null },
    select: {
      legacyCode: true,
      contractValue: true,
      openingPaidAmount: true,
      totalSessions: true,
      openingSessionsUsed: true,
    },
  });
  const byCode = new Map(stored.map((row) => [row.legacyCode!, row]));
  const differences: ContractDifference[] = [];
  for (const row of workbook.contracts?.rows ?? []) {
    const legacyCode = text(row.cells.legacyCode);
    if (!legacyCode) continue;
    const found = byCode.get(legacyCode);
    if (!found) {
      differences.push({ legacyCode, problem: "MISSING_IN_SYSTEM", details: [] });
      continue;
    }
    const details: string[] = [];
    const compare = (field: string, wanted: number | null, have: number) => {
      if (wanted !== have) details.push(`${field}: ${wanted ?? "?"} → ${have}`);
    };
    compare("value", parseWhole(row.cells.value), Number(found.contractValue));
    compare("paid", parseWhole(row.cells.paid), Number(found.openingPaidAmount));
    compare("sessions", parseWhole(row.cells.sessions), found.totalSessions);
    compare("sessionsUsed", parseWhole(row.cells.sessionsUsed), found.openingSessionsUsed);
    if (details.length > 0) differences.push({ legacyCode, problem: "DIFFERENT", details });
  }

  const customerCodes = new Set(
    (await db.customer.findMany({ where: { legacyCode: { not: null } }, select: { legacyCode: true } })).map(
      (row) => row.legacyCode!,
    ),
  );
  const missingCustomers = [
    ...new Set((workbook.customers?.rows ?? []).map((row) => text(row.cells.legacyCode)).filter(Boolean)),
  ].filter((code) => !customerCodes.has(code));

  return {
    lines,
    differences,
    missingCustomers,
    ok: lines.every((line) => line.ok) && differences.length === 0 && missingCustomers.length === 0,
  };
}

const METRIC_TEXT: Record<Metric, string> = {
  customers: "Số khách hàng / Customers",
  contracts: "Số hợp đồng / Contracts",
  value: "Tổng giá trị hợp đồng / Contract value",
  paid: "Tổng đã thanh toán / Paid",
  sessionsLeft: "Tổng số buổi còn lại / Sessions left",
};

export async function writeReconciliation(result: Reconciliation): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const totals = book.addWorksheet("Totals");
  totals.addRow([result.ok ? "KHỚP / MATCHES" : "LỆCH / DIFFERENCES"]);
  totals.addRow([]);
  totals.addRow(["", "Workbook", "System", "GymMaster", "Kết quả / Result"]);
  for (const line of result.lines) {
    totals.addRow([
      METRIC_TEXT[line.metric],
      line.workbook,
      line.system,
      line.control ?? "—",
      line.ok ? "OK" : "LỆCH / DIFF",
    ]);
  }
  totals.getRow(1).font = { bold: true };
  totals.getRow(3).font = { bold: true };
  totals.getColumn(1).width = 40;
  [2, 3, 4, 5].forEach((column) => (totals.getColumn(column).width = 18));

  const contracts = book.addWorksheet("Contracts");
  contracts.addRow(["Mã hợp đồng cũ / Legacy code", "Vấn đề / Problem", "Chi tiết / Details (workbook → system)"]);
  for (const item of result.differences) {
    contracts.addRow([
      item.legacyCode,
      item.problem === "MISSING_IN_SYSTEM" ? "Chưa có trong hệ thống / Missing" : "Khác / Different",
      item.details.join("; "),
    ]);
  }
  contracts.getRow(1).font = { bold: true };
  contracts.getColumn(1).width = 28;
  contracts.getColumn(2).width = 34;
  contracts.getColumn(3).width = 60;

  const customers = book.addWorksheet("Customers");
  customers.addRow(["Mã khách hàng cũ chưa có trong hệ thống / Customer legacy codes missing in the system"]);
  for (const code of result.missingCustomers) customers.addRow([code]);
  customers.getRow(1).font = { bold: true };
  customers.getColumn(1).width = 60;
  return Buffer.from(await book.xlsx.writeBuffer());
}
