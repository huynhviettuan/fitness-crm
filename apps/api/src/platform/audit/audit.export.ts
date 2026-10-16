import type { AuditEvent } from "@gymcrm/shared/audit";
import type { ExportDefinition } from "../export/export.service.js";
import { listAuditEvents } from "./audit.service.js";

/** The query keys of `GET /audit-events/export`: the list's own filters, not the page. */
export const AUDIT_EXPORT_QUERY = ["entityType", "entityId", "actorUserId", "from", "to"] as const;

const json = (values: Record<string, unknown> | null) => (values ? JSON.stringify(values) : "");

/** The action history to Excel (FR-PLT-008): who, when, what, and the values before and after. */
export const auditExport: ExportDefinition<AuditEvent> = {
  list: "audit-events",
  title: { vi: "Lịch sử thao tác", en: "Action history" },
  permission: "audit.export",
  columns: [
    { header: { vi: "Thời điểm", en: "When" }, kind: "datetime", value: (e) => e.at },
    { header: { vi: "Người thực hiện", en: "Made by" }, value: (e) => e.actor?.name, width: 24 },
    { header: { vi: "Loại bản ghi", en: "Record type" }, value: (e) => e.entityType },
    { header: { vi: "Mã bản ghi", en: "Record id" }, value: (e) => e.entityId, width: 38 },
    { header: { vi: "Thao tác", en: "Action" }, value: (e) => e.action, width: 28 },
    { header: { vi: "Trước", en: "Before" }, value: (e) => json(e.before), width: 48 },
    { header: { vi: "Sau", en: "After" }, value: (e) => json(e.after), width: 48 },
    { header: { vi: "Chi tiết", en: "Details" }, value: (e) => json(e.context), width: 36 },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listAuditEvents(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
