import type { Contract } from "@gymcrm/shared/contracts";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { statusLabel } from "../../platform/export/labels.js";
import { listContracts } from "./contract.service.js";

/** The list's filters (brief §5.3). */
const CONTRACT_FILTERS = [
  "q",
  "customerId",
  "branchId",
  "contractType",
  "from",
  "to",
  "serviceId",
  "ptId",
  "promotionId",
  "paymentStatus",
  "signed",
  "status",
] as const;
export const CONTRACT_LIST_QUERY = [...CONTRACT_FILTERS, "page", "pageSize"] as const;
/** The query keys of `GET /contracts/export`: the list's own filters, not the page. */
export const CONTRACT_EXPORT_QUERY = CONTRACT_FILTERS;

/** Contracts to Excel (brief §5.3): sessions and money as the list derives them. */
export const contractsExport: ExportDefinition<Contract> = {
  list: "contracts",
  title: { vi: "Hợp đồng", en: "Contracts" },
  permission: "contract.export",
  columns: [
    { header: { vi: "Mã hợp đồng", en: "Contract" }, value: (c) => c.contractCode, width: 14 },
    { header: { vi: "Ngày hợp đồng", en: "Contract date" }, kind: "date", value: (c) => c.contractDate },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (c) => c.branch.name, width: 18 },
    {
      header: { vi: "Loại", en: "Type" },
      value: (c, l) => (c.contractType === "NEW" ? (l === "vi" ? "Mới" : "New") : l === "vi" ? "Tái ký" : "Renewal"),
    },
    { header: { vi: "Dịch vụ", en: "Service" }, value: (c) => c.service?.name ?? "", width: 18 },
    { header: { vi: "Đơn giá", en: "Unit price" }, kind: "money", value: (c) => c.approvedUnitPrice },
    { header: { vi: "Mã KH", en: "Customer code" }, value: (c) => c.customer.customerCode, width: 12 },
    { header: { vi: "Khách hàng", en: "Customer" }, value: (c) => c.customer.fullName, width: 28 },
    { header: { vi: "Số điện thoại", en: "Phone" }, maskedBy: "customer.phone", value: (c) => c.customerPhone },
    { header: { vi: "Gói", en: "Package" }, value: (c) => c.packageName, width: 24 },
    { header: { vi: "Ngày bắt đầu", en: "Start" }, kind: "date", value: (c) => c.startDate },
    { header: { vi: "Ngày kết thúc", en: "End" }, kind: "date", value: (c) => c.endDate },
    { header: { vi: "Trạng thái", en: "Status" }, value: (c, l) => statusLabel("contract", c.status, l) },
    { header: { vi: "Tổng số buổi", en: "Sessions" }, kind: "number", value: (c) => c.totalSessions },
    {
      header: { vi: "Đã tập", en: "Used" },
      kind: "number",
      value: (c) => c.openingSessionsUsed + c.completedSessions,
    },
    { header: { vi: "Còn lại", en: "Left" }, kind: "number", value: (c) => c.remainingSessions },
    { header: { vi: "Giá trị", en: "Value" }, kind: "money", value: (c) => c.contractValue },
    { header: { vi: "Đã thu", en: "Paid" }, kind: "money", value: (c) => c.paidAmount },
    { header: { vi: "Công nợ", en: "Debt" }, kind: "money", value: (c) => c.debt },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (c) => c.createdAt },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listContracts(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
