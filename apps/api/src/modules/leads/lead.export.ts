import type { Lead } from "@flow/shared/leads";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText, statusLabel } from "../../platform/export/labels.js";
import { listLeads } from "./lead.service.js";

/** The query keys of `GET /leads/export`: the list's own filters, not the page. */
export const LEAD_EXPORT_QUERY = ["q", "status", "channelId", "sourceId", "needGroupId"] as const;

/** Leads to Excel (brief §4.1): the rows of the lead list, phone and email left out when hidden (D-017). */
export const leadsExport: ExportDefinition<Lead> = {
  list: "leads",
  title: { vi: "Lead", en: "Leads" },
  permission: "lead.export",
  columns: [
    { header: { vi: "Mã lead", en: "Lead code" }, value: (l) => l.leadCode, width: 12 },
    { header: { vi: "Họ và tên", en: "Full name" }, value: (l) => l.fullName, width: 28 },
    { header: { vi: "Số điện thoại", en: "Phone" }, maskedBy: "customer.phone", value: (l) => l.phone },
    { header: { vi: "Email", en: "Email" }, maskedBy: "customer.email", value: (l) => l.email, width: 28 },
    { header: { vi: "Trạng thái", en: "Status" }, value: (l, loc) => statusLabel("lead", l.status, loc) },
    { header: { vi: "Kênh", en: "Channel" }, value: (l, loc) => optionText(l.channel, loc) },
    { header: { vi: "Nguồn", en: "Source" }, value: (l, loc) => optionText(l.source, loc) },
    { header: { vi: "Nhóm nhu cầu", en: "Need group" }, value: (l, loc) => optionText(l.needGroup, loc), width: 28 },
    { header: { vi: "Người phụ trách", en: "Person in charge" }, value: (l) => l.pic?.name },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (l) => l.branch.name },
    { header: { vi: "Lịch hẹn", en: "Appointment" }, kind: "datetime", value: (l) => l.appointmentAt },
    { header: { vi: "Ngày liên hệ lại", en: "Contact again" }, kind: "date", value: (l) => l.contactAgainOn },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (l) => l.createdAt },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listLeads(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
