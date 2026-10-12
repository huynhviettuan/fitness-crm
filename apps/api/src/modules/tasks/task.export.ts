import type { Task } from "@flow/shared/tasks";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText, statusLabel, yesNo } from "../../platform/export/labels.js";
import { listTasks } from "./task.service.js";

/** The query keys of `GET /tasks/export`: the list's own filters, not the page. */
export const TASK_EXPORT_QUERY = ["view", "status", "overdueOnly", "q"] as const;

/** Tasks to Excel (brief §8.2): the tasks of the chosen view. */
export const tasksExport: ExportDefinition<Task> = {
  list: "tasks",
  title: { vi: "Công việc", en: "Tasks" },
  permission: "task.export",
  columns: [
    { header: { vi: "Tiêu đề", en: "Title" }, value: (t) => t.title, width: 40 },
    { header: { vi: "Trạng thái", en: "Status" }, value: (t, l) => statusLabel("task", t.status, l) },
    { header: { vi: "Ưu tiên", en: "Priority" }, value: (t, l) => statusLabel("priority", t.priority, l) },
    { header: { vi: "Hạn", en: "Due" }, kind: "datetime", value: (t) => t.dueAt },
    { header: { vi: "Quá hạn", en: "Overdue" }, value: (t, l) => yesNo(t.overdue, l) },
    { header: { vi: "Người giao", en: "Given by" }, value: (t) => t.assigner.name },
    { header: { vi: "Người nhận", en: "Assignee" }, value: (t) => t.assignee?.name },
    {
      header: { vi: "Phòng ban", en: "Department" },
      value: (t, l) => (t.department ? optionText(t.department, l) : ""),
    },
    { header: { vi: "Liên quan đến", en: "About" }, value: (t) => t.entity?.label, width: 28 },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (t) => t.branch.name },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (t) => t.createdAt },
    { header: { vi: "Hoàn thành", en: "Done" }, kind: "datetime", value: (t) => t.doneAt },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listTasks(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
