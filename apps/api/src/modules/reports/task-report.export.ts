import type { TaskReportRow } from "@gymcrm/shared/reports";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { pageOf, WHOLE } from "./money-report.export.js";
import { taskReport } from "./task-report.service.js";

// The tasks report to Excel (brief §9, FR-TASK-006; M9.1): a row per person, then a row per department, a total row last.

/** The query keys of the tasks report and its export. */
export const TASK_REPORT_QUERY = ["from", "to", "branchId", "userId"] as const;

type Line = {
  side: "person" | "department" | "total";
  row: Omit<TaskReportRow, "user" | "department"> & Partial<TaskReportRow>;
};

export const taskReportExport: ExportDefinition<Line> = {
  list: "task-report",
  title: { vi: "Giao việc", en: "Tasks" },
  permission: "report.tasksExport",
  columns: [
    {
      header: { vi: "Theo", en: "By" },
      value: ({ side }, l) =>
        side === "person"
          ? l === "vi"
            ? "Người nhận việc"
            : "Person"
          : side === "department"
            ? l === "vi"
              ? "Phòng ban"
              : "Department"
            : WHOLE[l],
    },
    { header: { vi: "Nhân viên", en: "Person" }, value: ({ row }) => row.user?.name ?? "", width: 26 },
    {
      header: { vi: "Phòng ban", en: "Department" },
      value: ({ row }, l) => (row.department ? (l === "vi" ? row.department.labelVi : row.department.labelEn) : ""),
      width: 22,
    },
    { header: { vi: "Việc giao", en: "Assigned" }, kind: "number", value: ({ row }) => row.assigned },
    { header: { vi: "Đúng hạn", en: "On time" }, kind: "number", value: ({ row }) => row.doneOnTime },
    { header: { vi: "Xong trễ", en: "Done late" }, kind: "number", value: ({ row }) => row.doneLate },
    { header: { vi: "Quá hạn", en: "Overdue" }, kind: "number", value: ({ row }) => row.overdue },
    { header: { vi: "Đang làm", en: "Open" }, kind: "number", value: ({ row }) => row.open },
    { header: { vi: "Đã hủy", en: "Cancelled" }, kind: "number", value: ({ row }) => row.cancelled },
    {
      header: { vi: "Tỷ lệ đúng hạn (%)", en: "On-time rate (%)" },
      kind: "number",
      value: ({ row }) => row.onTimeRate,
    },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await taskReport(actor, query);
    const all: Line[] = [
      ...report.byPerson.map((row) => ({ side: "person" as const, row })),
      ...report.byDepartment.map((row) => ({ side: "department" as const, row })),
      { side: "total", row: report.totals },
    ];
    return pageOf(all, page, pageSize);
  },
};
