import type { Customer } from "@gymcrm/shared/customers";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText, statusLabel } from "../../platform/export/labels.js";
import { listCustomers } from "./customer.service.js";

/** The query keys of `GET /customers/export`: the list's own filters (A-075), not the page. */
export const CUSTOMER_EXPORT_QUERY = [
  "search",
  "branchId",
  "staffId",
  "registeredFrom",
  "registeredTo",
  "birthdayMonth",
  "noEmail",
] as const;

/** Customers to Excel (brief §4.2): the rows of the screen, with the fields the user cannot see left out (D-017). */
export const customersExport: ExportDefinition<Customer> = {
  list: "customers",
  title: { vi: "Khách hàng", en: "Customers" },
  permission: "customer.export",
  columns: [
    { header: { vi: "Mã KH", en: "Code" }, value: (c) => c.customerCode, width: 12 },
    { header: { vi: "Họ và tên", en: "Full name" }, value: (c) => c.fullName, width: 28 },
    { header: { vi: "Số điện thoại", en: "Phone" }, maskedBy: "customer.phone", value: (c) => c.phone },
    { header: { vi: "Email", en: "Email" }, maskedBy: "customer.email", value: (c) => c.email, width: 28 },
    { header: { vi: "Ngày sinh", en: "Date of birth" }, kind: "date", value: (c) => c.dateOfBirth },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (c) => c.branch.name },
    { header: { vi: "Nhân viên phụ trách", en: "Staff in charge" }, value: (c) => c.staffInCharge?.name },
    { header: { vi: "Nhóm khách hàng", en: "Customer group" }, value: (c, l) => optionText(c.customerGroup, l) },
    { header: { vi: "Địa chỉ", en: "Address" }, maskedBy: "customer.address", value: (c) => c.address, width: 32 },
    {
      header: { vi: "Liên hệ khẩn cấp", en: "Emergency contact" },
      maskedBy: "customer.address",
      value: (c) => [c.emergencyContactName, c.emergencyContactPhone].filter(Boolean).join(" · "),
      width: 26,
    },
    { header: { vi: "Trạng thái", en: "Status" }, value: (c, l) => statusLabel("customer", c.status, l) },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (c) => c.createdAt },
  ],
  fetch: (actor, { search, ...filters }, page, pageSize) =>
    listCustomers(actor, { ...filters, q: search, page: String(page), pageSize: String(pageSize) }),
};
