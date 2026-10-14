import ExcelJS from "exceljs";
import type { Applied } from "./apply.js";
import { summarize, type Plan } from "./plan.js";

// The report of an import (brief §11, D-039; M9.2): what will happen or happened, the cleanup list for the owner to confirm,
// and the rows left out with the reason.

const ACTION_TEXT = {
  CREATE: "Sẽ tạo / To create",
  ALREADY_IMPORTED: "Đã nhập trước đó / Already imported",
  DUPLICATE: "Trùng / Duplicate",
  REJECT: "Từ chối / Rejected",
} as const;

const CLEANUP_TEXT = {
  SESSIONS_DIFFER_FROM_NAME: "Số buổi khác số trong tên gói / Sessions differ from the package name",
  PRICE_DIFFERS_FROM_TIER: "Đơn giá khác giá bậc / Price differs from the tier",
  NO_SERVICE: "Chưa gắn dịch vụ / No service matched",
  NO_TIER: "Không có bậc giá cho số buổi / No tier for the sessions",
} as const;

export async function writeReport(plan: Plan, mode: "DRY_RUN" | "COMMIT", applied: Applied | null): Promise<Buffer> {
  const book = new ExcelJS.Workbook();

  const summary = book.addWorksheet("Summary");
  summary.addRow([mode === "COMMIT" ? "Đã nhập / Imported" : "Chạy thử, chưa ghi gì / Dry run, nothing written"]);
  summary.addRow([]);
  summary.addRow(["Sheet", ...Object.values(ACTION_TEXT), ...(applied ? ["Đã tạo / Created", "Lỗi / Failed"] : [])]);
  const counts = summarize(plan);
  for (const sheet of ["customers", "contracts", "staff"] as const) {
    summary.addRow([
      sheet,
      counts[sheet].CREATE,
      counts[sheet].ALREADY_IMPORTED,
      counts[sheet].DUPLICATE,
      counts[sheet].REJECT,
      ...(applied ? [applied[sheet].created, applied[sheet].failed.length] : []),
    ]);
  }
  for (const issue of plan.sheetIssues) summary.addRow([issue.sheet, issue.code, issue.fields.join(", ")]);
  for (const item of plan.unknownColumns)
    summary.addRow([item.sheet, "Cột chưa dùng / Unused columns", item.headers.join(", ")]);
  for (const name of plan.ignoredSheets) summary.addRow([name, "Tab bị bỏ qua / Sheet ignored"]);
  summary.getColumn(1).width = 28;
  summary.getRow(3).font = { bold: true };

  const cleanup = book.addWorksheet("Cleanup");
  cleanup.addRow([
    "Mã hợp đồng cũ / Legacy code",
    "Tên gói cũ / Old name",
    "Tên mới / New name",
    "Số buổi / Sessions",
    "Giá trị / Value",
    "Lý do / Reason",
  ]);
  for (const contract of plan.contracts.filter((item) => item.cleanup.length > 0)) {
    cleanup.addRow([
      contract.entry.legacyCode,
      contract.packageName,
      contract.newName,
      contract.sessions,
      contract.value,
      contract.cleanup.map((reason) => CLEANUP_TEXT[reason]).join("; "),
    ]);
  }
  cleanup.getRow(1).font = { bold: true };
  cleanup.getColumn(1).width = 24;
  cleanup.getColumn(2).width = 28;
  cleanup.getColumn(3).width = 28;
  cleanup.getColumn(6).width = 70;

  const left = book.addWorksheet("Left out");
  left.addRow(["Sheet", "Dòng / Row", "Mã cũ / Legacy code", "Nội dung / Item", "Kết quả / Result", "Lý do / Why"]);
  for (const item of [...plan.customers, ...plan.staff, ...plan.contracts]) {
    if (item.entry.action === "CREATE" || item.entry.action === "ALREADY_IMPORTED") continue;
    left.addRow([
      item.entry.sheet,
      item.entry.row,
      item.entry.legacyCode,
      item.entry.label,
      ACTION_TEXT[item.entry.action],
      item.entry.issues.join("; "),
    ]);
  }
  if (applied) {
    for (const sheet of ["customers", "staff", "contracts"] as const) {
      for (const failure of applied[sheet].failed) {
        left.addRow([sheet, failure.row, failure.legacyCode, "", "Lỗi khi ghi / Failed to write", failure.reason]);
      }
    }
  }
  left.getRow(1).font = { bold: true };
  left.getColumn(4).width = 30;
  left.getColumn(5).width = 30;
  left.getColumn(6).width = 60;

  return Buffer.from(await book.xlsx.writeBuffer());
}
