import type { BookingReportRow, PtRevenueRow, PtRevenueTrainer } from "@flow/shared/reports";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { pageOf, PERIOD_QUERY, WHOLE } from "./money-report.export.js";
import { bookingReport, ptRevenueReport } from "./pt-report.service.js";

// The PT revenue allocation and the booking report to Excel (brief §6.5, §9; A-166, A-171).

/** The query keys of the PT revenue export. */
export const PT_REVENUE_QUERY = [...PERIOD_QUERY, "trainerId"] as const;
/** The query keys of the booking report and its export (the page is the screen's). */
export const BOOKING_REPORT_QUERY = [...PERIOD_QUERY, "trainerId", "type", "status", "page", "pageSize"] as const;

/** A line of the file: a contract row, the totals of one PT, or the grand total. */
type PtLine =
  | { kind: "row"; trainer: PtRevenueTrainer; row: PtRevenueRow }
  | { kind: "trainer"; trainer: PtRevenueTrainer }
  | { kind: "total"; credited: number; classSessions: number; allocation: number; adjustments: number };

const TRAINER_TOTAL = { vi: "Tổng", en: "Total of" };

/**
 * The columns follow GymMaster's "employee_pt_training" (D-032): employee, member, branch, contract, allocation,
 * credited sessions, rates, the PT's allocation, the PT's total, and the adjustments. After the rows of each PT comes
 * a row with that PT's totals, and the grand total is last.
 */
export const ptRevenueExport: ExportDefinition<PtLine> = {
  list: "pt-revenue",
  title: { vi: "Doanh thu phân bổ PT", en: "PT revenue allocation" },
  permission: "report.ptRevenueExport",
  columns: [
    {
      header: { vi: "Mã nhân viên", en: "Employee code" },
      value: (line) => (line.kind === "total" ? "" : line.trainer.employee.employeeCode),
      width: 14,
    },
    {
      header: { vi: "Tên nhân viên", en: "Employee" },
      value: (line, l) =>
        line.kind === "total"
          ? WHOLE[l]
          : line.kind === "trainer"
            ? `${TRAINER_TOTAL[l]} ${line.trainer.employee.fullName}`
            : line.trainer.employee.fullName,
      width: 26,
    },
    {
      header: { vi: "Mã hội viên", en: "Member code" },
      value: (line) => (line.kind === "row" ? line.row.customer.customerCode : ""),
    },
    {
      header: { vi: "Tên hội viên", en: "Member" },
      value: (line) => (line.kind === "row" ? line.row.customer.fullName : ""),
      width: 26,
    },
    {
      header: { vi: "Số điện thoại", en: "Phone" },
      maskedBy: "customer.phone",
      value: (line) => (line.kind === "row" ? line.row.customer.phone : ""),
      width: 16,
    },
    {
      header: { vi: "Chi nhánh", en: "Branch" },
      value: (line) => (line.kind === "row" ? line.row.branch.name : ""),
      width: 18,
    },
    {
      header: { vi: "Mã hợp đồng", en: "Contract" },
      value: (line) => (line.kind === "row" ? line.row.contract.contractCode : ""),
      width: 14,
    },
    {
      header: { vi: "Dịch vụ", en: "Service" },
      value: (line) => (line.kind === "row" ? (line.row.contract.service?.name ?? "") : ""),
      width: 22,
    },
    {
      header: { vi: "Giá trị hợp đồng", en: "Contract value" },
      kind: "money",
      value: (line) => (line.kind === "row" ? line.row.contract.contractValue : null),
    },
    {
      header: { vi: "Giá trị phân bổ", en: "Allocation value" },
      kind: "money",
      value: (line) => (line.kind === "row" ? line.row.allocationValue : null),
    },
    {
      header: { vi: "Số buổi", en: "Sessions" },
      kind: "number",
      value: (line) => (line.kind === "row" ? line.row.sessions : null),
    },
    {
      header: { vi: "Phân bổ mỗi buổi", en: "Allocation per session" },
      kind: "money",
      value: (line) => (line.kind === "row" ? line.row.allocationPerSession : null),
    },
    {
      header: { vi: "Show dạy", en: "Credited sessions" },
      kind: "number",
      value: (line) =>
        line.kind === "row" ? line.row.credited : line.kind === "trainer" ? line.trainer.credited : line.credited,
    },
    {
      header: { vi: "Trong ca", en: "In shift" },
      kind: "number",
      value: (line) => (line.kind === "row" ? line.row.inShift : line.kind === "trainer" ? line.trainer.inShift : null),
    },
    {
      header: { vi: "Ngoài ca", en: "Outside shift" },
      kind: "number",
      value: (line) =>
        line.kind === "row" ? line.row.outsideShift : line.kind === "trainer" ? line.trainer.outsideShift : null,
    },
    {
      header: { vi: "Buổi lớp đã dạy", en: "Class sessions taught" },
      kind: "number",
      value: (line) =>
        line.kind === "trainer" ? line.trainer.classSessions : line.kind === "total" ? line.classSessions : null,
    },
    {
      header: { vi: "Tỷ lệ hoa hồng (%)", en: "Commission rate (%)" },
      kind: "number",
      value: (line) => (line.kind === "row" ? line.row.commissionRate : null),
    },
    {
      header: { vi: "Tỷ lệ công (%)", en: "Timesheet rate (%)" },
      kind: "number",
      value: (line) => (line.kind === "row" ? line.row.timesheetRate : null),
    },
    {
      header: { vi: "Doanh thu PT", en: "PT allocation" },
      kind: "money",
      value: (line) =>
        line.kind === "row" ? line.row.allocation : line.kind === "trainer" ? line.trainer.allocation : line.allocation,
    },
    {
      header: { vi: "Điều chỉnh", en: "Adjustments" },
      kind: "money",
      value: (line) =>
        line.kind === "row"
          ? line.row.adjustments
          : line.kind === "trainer"
            ? line.trainer.adjustments
            : line.adjustments,
    },
    {
      header: { vi: "Ghi chú", en: "Note" },
      value: (line) => (line.kind === "row" ? line.row.contract.note : ""),
      width: 28,
    },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await ptRevenueReport(actor, query);
    const all: PtLine[] = [
      ...report.trainers.flatMap((trainer): PtLine[] => [
        ...trainer.rows.map((row): PtLine => ({ kind: "row", trainer, row })),
        { kind: "trainer", trainer },
      ]),
      { kind: "total", ...report.totals },
    ];
    return pageOf(all, page, pageSize);
  },
};

const TYPE_LABEL = {
  PT: { vi: "Buổi PT", en: "PT session" },
  BURN_SHOW: { vi: "Burn Show (thêm tay)", en: "Burn Show (added by hand)" },
} as const;

/** The booking report to Excel: the rows the screen shows for the same filter, a page at a time. */
export const bookingReportExport: ExportDefinition<BookingReportRow> = {
  list: "booking-report",
  title: { vi: "Báo cáo booking", en: "Booking report" },
  permission: "report.bookingsExport",
  columns: [
    { header: { vi: "Mã hội viên", en: "Member code" }, value: (row) => row.customer.customerCode },
    { header: { vi: "Hội viên", en: "Member" }, value: (row) => row.customer.fullName, width: 26 },
    {
      header: { vi: "Số điện thoại", en: "Phone" },
      maskedBy: "customer.phone",
      value: (row) => row.customer.phone,
      width: 16,
    },
    { header: { vi: "Hợp đồng", en: "Contract" }, value: (row) => row.contract.contractCode, width: 14 },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (row) => row.branch.name, width: 18 },
    { header: { vi: "Loại", en: "Type" }, value: (row, l) => TYPE_LABEL[row.type][l], width: 22 },
    { header: { vi: "Giờ hẹn", en: "Scheduled" }, kind: "datetime", value: (row) => row.scheduledStart },
    { header: { vi: "Giờ check-in", en: "Check-in" }, kind: "datetime", value: (row) => row.checkedInAt },
    { header: { vi: "Giờ check-out", en: "Check-out" }, kind: "datetime", value: (row) => row.checkedOutAt },
    {
      header: { vi: "Trạng thái", en: "Status" },
      value: (row, l) => (l === "vi" ? row.status.labelVi : row.status.labelEn),
    },
    { header: { vi: "Nhân viên", en: "Staff" }, value: (row) => row.staff.fullName, width: 24 },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (row) => row.createdAt },
  ],
  fetch: (actor, query, page, pageSize) =>
    bookingReport(actor, { ...query, page: String(page), pageSize: String(pageSize) }),
};
