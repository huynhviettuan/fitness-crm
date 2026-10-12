import type { TrashEntry } from "@flow/shared/trash";
import type { ExportDefinition } from "../export/export.service.js";
import { optionText, statusLabel } from "../export/labels.js";
import { listTrash } from "./trash.service.js";

/** The query keys of `GET /trash/export`: the list's own filters, not the page. */
export const TRASH_EXPORT_QUERY = ["entityType", "from", "to"] as const;

/** The trash to Excel (FR-TRASH-002, D-035): what was deleted, by whom, and why. */
export const trashExport: ExportDefinition<TrashEntry> = {
  list: "trash",
  title: { vi: "Thùng rác", en: "Trash" },
  permission: "trash.export",
  columns: [
    { header: { vi: "Ngày xóa", en: "Deleted" }, kind: "datetime", value: (e) => e.deletedAt },
    { header: { vi: "Loại", en: "Type" }, value: (e, l) => statusLabel("trashEntity", e.entityType, l) },
    { header: { vi: "Nội dung", en: "Record" }, value: (e) => e.title, width: 40 },
    { header: { vi: "Số tiền", en: "Amount" }, kind: "money", value: (e) => e.amount },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (e) => e.branch.name },
    { header: { vi: "Người xóa", en: "Deleted by" }, value: (e) => e.deletedBy },
    { header: { vi: "Lý do", en: "Reason" }, value: (e, l) => optionText(e.reason, l), width: 32 },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listTrash(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
