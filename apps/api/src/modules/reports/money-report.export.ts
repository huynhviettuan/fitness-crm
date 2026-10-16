import type { CashBookRow, MoneyLine } from "@gymcrm/shared/finance";
import { bandLabel, type ContractReportRow, type ExceptionPriceRow } from "@gymcrm/shared/contracts";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText } from "../../platform/export/labels.js";
import { cashBook, incomeExpense } from "./cash-book.service.js";
import { contractReport, exceptionPriceReport } from "./contract-report.service.js";

// The money and contract reports to Excel (brief §9, A-139 to A-141): the rows the screen shows, a total row last.

/** The query keys of the money and contract report exports: the period and branch. */
export const PERIOD_QUERY = ["from", "to", "branchId"] as const;

export const WHOLE = { vi: "Tổng cộng", en: "Total" };

/** One page of a report held in memory, with its total row appended. */
export function pageOf<T>(all: T[], page: number, pageSize: number) {
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
}

type CashBookLine = { total: boolean; row: Omit<CashBookRow, "branch" | "method"> & Partial<CashBookRow> };

export const cashBookExport: ExportDefinition<CashBookLine> = {
  list: "cash-book",
  title: { vi: "Sổ quỹ", en: "Cash book" },
  permission: "report.cashBookExport",
  columns: [
    {
      header: { vi: "Chi nhánh", en: "Branch" },
      value: ({ total, row }, l) => (total ? WHOLE[l] : (row.branch?.name ?? "")),
      width: 20,
    },
    {
      header: { vi: "Hình thức", en: "Method" },
      value: ({ row }, l) => (row.method ? optionText(row.method, l) : ""),
      width: 20,
    },
    { header: { vi: "Đầu kỳ", en: "Opening" }, kind: "money", value: ({ row }) => row.opening },
    { header: { vi: "Thu", en: "In" }, kind: "money", value: ({ row }) => row.inflow },
    { header: { vi: "Chi", en: "Out" }, kind: "money", value: ({ row }) => row.outflow },
    { header: { vi: "Cuối kỳ", en: "Closing" }, kind: "money", value: ({ row }) => row.closing },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const book = await cashBook(actor, query);
    const all: CashBookLine[] = [...book.rows.map((row) => ({ total: false, row })), { total: true, row: book.totals }];
    return pageOf(all, page, pageSize);
  },
};

const KIND_LABEL = {
  CONTRACT_PAYMENT: { vi: "Thu hợp đồng", en: "Contract payments" },
  INCOME: { vi: "Thu khác", en: "Other income" },
  EXPENSE: { vi: "Chi", en: "Expense" },
} as const;

type MoneyRow = { line: MoneyLine | null; income?: number; expense?: number; net?: number };

export const incomeExpenseExport: ExportDefinition<MoneyRow> = {
  list: "income-expense",
  title: { vi: "Thu chi", en: "Income and expense" },
  permission: "report.incomeExpenseExport",
  columns: [
    {
      header: { vi: "Loại", en: "Kind" },
      value: ({ line }, l) => (line ? KIND_LABEL[line.kind][l] : WHOLE[l]),
      width: 22,
    },
    {
      header: { vi: "Danh mục", en: "Category" },
      value: ({ line }, l) => (line?.category ? optionText(line.category, l) : ""),
      width: 28,
    },
    { header: { vi: "Số phiếu", en: "Vouchers" }, kind: "number", value: ({ line }) => line?.count },
    { header: { vi: "Số tiền", en: "Amount" }, kind: "money", value: ({ line }) => line?.amount },
    { header: { vi: "Tổng thu", en: "Income" }, kind: "money", value: ({ line, income }) => (line ? null : income) },
    { header: { vi: "Tổng chi", en: "Expense" }, kind: "money", value: ({ line, expense }) => (line ? null : expense) },
    { header: { vi: "Chênh lệch", en: "Net" }, kind: "money", value: ({ line, net }) => (line ? null : net) },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await incomeExpense(actor, query);
    const all: MoneyRow[] = [
      ...report.lines.map((line) => ({ line })),
      { line: null, income: report.income, expense: report.expense, net: report.net },
    ];
    return pageOf(all, page, pageSize);
  },
};

type ContractLine = { total: boolean; row: Omit<ContractReportRow, "service" | "band"> & Partial<ContractReportRow> };

export const contractReportExport: ExportDefinition<ContractLine> = {
  list: "contract-report",
  title: { vi: "Báo cáo hợp đồng", en: "Contract report" },
  permission: "report.contractsExport",
  columns: [
    {
      header: { vi: "Dịch vụ", en: "Service" },
      value: ({ total, row }, l) =>
        total ? WHOLE[l] : (row.service?.name ?? (l === "vi" ? "Chưa có dịch vụ" : "No service")),
      width: 24,
    },
    {
      header: { vi: "Nhóm số buổi", en: "Session band" },
      value: ({ row }) => (row.band ? bandLabel(row.band) : ""),
    },
    { header: { vi: "Hợp đồng mới", en: "New" }, kind: "number", value: ({ row }) => row.newContracts },
    { header: { vi: "Tái ký", en: "Renewed" }, kind: "number", value: ({ row }) => row.renewedContracts },
    { header: { vi: "Giá trị hợp đồng", en: "Contract value" }, kind: "money", value: ({ row }) => row.value },
    { header: { vi: "Doanh thu thu được", en: "Revenue" }, kind: "money", value: ({ row }) => row.revenue },
    { header: { vi: "Công nợ", en: "Debt" }, kind: "money", value: ({ row }) => row.debt },
    { header: { vi: "Sắp hết hạn", en: "Expiring soon" }, kind: "number", value: ({ row }) => row.expiringSoon },
    { header: { vi: "Sắp hết buổi", en: "Running out" }, kind: "number", value: ({ row }) => row.runningOut },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await contractReport(actor, query);
    const all: ContractLine[] = [
      ...report.rows.map((row) => ({ total: false, row })),
      { total: true, row: report.totals },
    ];
    return pageOf(all, page, pageSize);
  },
};

type ExceptionLine = { side: "creator" | "approver" | "total"; row: ExceptionPriceRow | null; total?: number[] };

export const exceptionPriceExport: ExportDefinition<ExceptionLine> = {
  list: "exception-prices",
  title: { vi: "Giá ngoại lệ", en: "Exception prices" },
  permission: "report.exceptionPricesExport",
  columns: [
    {
      header: { vi: "Theo", en: "By" },
      value: ({ side }, l) =>
        side === "creator"
          ? l === "vi"
            ? "Người tạo"
            : "Creator"
          : side === "approver"
            ? l === "vi"
              ? "Người duyệt"
              : "Approver"
            : WHOLE[l],
    },
    { header: { vi: "Nhân viên", en: "Person" }, value: ({ row }) => row?.user.name, width: 26 },
    {
      header: { vi: "Hợp đồng", en: "Contracts" },
      kind: "number",
      value: ({ row, total }) => row?.contracts ?? total?.[0],
    },
    {
      header: { vi: "Giá ngoại lệ", en: "Exceptions" },
      kind: "number",
      value: ({ row, total }) => row?.exceptions ?? total?.[1],
    },
    {
      header: { vi: "Tỷ lệ (%)", en: "Share (%)" },
      kind: "number",
      value: ({ row, total }) => row?.share ?? total?.[2],
    },
    {
      header: { vi: "Chênh lệch so với giá bậc", en: "Difference from tier price" },
      kind: "money",
      value: ({ row, total }) => row?.difference ?? total?.[3],
    },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await exceptionPriceReport(actor, query);
    const all: ExceptionLine[] = [
      ...report.byCreator.map((row) => ({ side: "creator" as const, row })),
      ...report.byApprover.map((row) => ({ side: "approver" as const, row })),
      {
        side: "total",
        row: null,
        total: [report.totals.contracts, report.totals.exceptions, report.totals.share, report.totals.difference],
      },
    ];
    return pageOf(all, page, pageSize);
  },
};
