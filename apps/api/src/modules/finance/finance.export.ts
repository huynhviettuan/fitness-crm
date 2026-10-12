import type { CashTransaction, Payment } from "@flow/shared/finance";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText, statusLabel } from "../../platform/export/labels.js";
import { listCashTransactions } from "./cash.service.js";
import { listPayments } from "./payment.service.js";

/** The query keys of `GET /payments/export` and `GET /cash-transactions/export`: the list's filters, not the page. */
export const PAYMENT_EXPORT_QUERY = ["from", "to", "contractId", "customerId"] as const;
export const CASH_EXPORT_QUERY = ["from", "to", "type"] as const;

/** Receipts to Excel (brief §8.1): the valid ones the list shows. */
export const paymentsExport: ExportDefinition<Payment> = {
  list: "payments",
  title: { vi: "Phiếu thu", en: "Receipts" },
  permission: "payment.export",
  columns: [
    { header: { vi: "Ngày thu", en: "Paid on" }, kind: "date", value: (p) => p.paidOn },
    { header: { vi: "Hợp đồng", en: "Contract" }, value: (p) => p.contract.contractCode, width: 14 },
    { header: { vi: "Mã KH", en: "Customer code" }, value: (p) => p.customer.customerCode, width: 12 },
    { header: { vi: "Khách hàng", en: "Customer" }, value: (p) => p.customer.fullName, width: 28 },
    { header: { vi: "Số tiền", en: "Amount" }, kind: "money", value: (p) => p.amount },
    { header: { vi: "Hình thức", en: "Method" }, value: (p, l) => optionText(p.method, l) },
    { header: { vi: "Duyệt", en: "Approval" }, value: (p, l) => statusLabel("approval", p.approvalStatus, l) },
    { header: { vi: "Người tạo", en: "Created by" }, value: (p) => p.createdBy },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (p) => p.createdAt },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listPayments(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};

/** Other income and expenses to Excel (brief §8.1). */
export const cashExport: ExportDefinition<CashTransaction> = {
  list: "cash-transactions",
  title: { vi: "Thu chi", en: "Income and expenses" },
  permission: "cash.export",
  columns: [
    { header: { vi: "Ngày", en: "Date" }, kind: "date", value: (t) => t.occurredOn },
    { header: { vi: "Loại", en: "Type" }, value: (t, l) => statusLabel("cashType", t.type, l) },
    { header: { vi: "Danh mục", en: "Category" }, value: (t, l) => optionText(t.category, l), width: 24 },
    { header: { vi: "Số tiền", en: "Amount" }, kind: "money", value: (t) => t.amount },
    { header: { vi: "Mô tả", en: "Description" }, value: (t) => t.description, width: 32 },
    { header: { vi: "Số chứng từ", en: "Reference" }, value: (t) => t.reference },
    { header: { vi: "Chi nhánh", en: "Branch" }, value: (t) => t.branch.name },
    { header: { vi: "Duyệt", en: "Approval" }, value: (t, l) => statusLabel("approval", t.approvalStatus, l) },
    { header: { vi: "Người tạo", en: "Created by" }, value: (t) => t.createdBy },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (t) => t.createdAt },
  ],
  fetch: (actor, filters, page, pageSize) =>
    listCashTransactions(actor, { ...filters, page: String(page), pageSize: String(pageSize) }),
};
