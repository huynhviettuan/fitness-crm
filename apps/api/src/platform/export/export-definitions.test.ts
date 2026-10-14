import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@flow/shared/permissions";
import { contractsExport } from "../../modules/contracts/contract.export.js";
import { customersExport } from "../../modules/customers/customer.export.js";
import { cashExport, memberDebtExport, paymentsExport } from "../../modules/finance/finance.export.js";
import { leadsExport } from "../../modules/leads/lead.export.js";
import {
  cashBookExport,
  contractReportExport,
  exceptionPriceExport,
  incomeExpenseExport,
} from "../../modules/reports/money-report.export.js";
import { bookingReportExport, ptRevenueExport } from "../../modules/reports/pt-report.export.js";
import { consultingReportExport, leadAnalysisExport } from "../../modules/reports/report.export.js";
import { taskReportExport } from "../../modules/reports/task-report.export.js";
import { tasksExport } from "../../modules/tasks/task.export.js";
import { usersExport } from "../../modules/users/user.export.js";
import { auditExport } from "../audit/audit.export.js";
import { trashExport } from "../trash/trash.export.js";
import type { ExportDefinition } from "./export.service.js";

// AC-01 (docs/14): a role with phone numbers hidden never sees them on any screen or export. Every export is listed here, so a
// new one cannot be added without passing the two checks below (M9.1).
const EXPORTS: ExportDefinition<never>[] = [
  contractsExport,
  customersExport,
  paymentsExport,
  cashExport,
  memberDebtExport,
  leadsExport,
  cashBookExport,
  incomeExpenseExport,
  contractReportExport,
  exceptionPriceExport,
  ptRevenueExport,
  bookingReportExport,
  consultingReportExport,
  leadAnalysisExport,
  taskReportExport,
  tasksExport,
  usersExport,
  auditExport,
  trashExport,
] as unknown as ExportDefinition<never>[];

/** A column that carries a person's contact details or documents (brief §2, D-017, D-042). */
const PERSONAL = /phone|điện thoại|sđt|email|cccd|passport|hộ chiếu|id number|giấy tờ|health|sức khỏe/i;

describe("every export (AC-01, brief §2)", () => {
  it("keeps one definition for each list, with its own permission", () => {
    const lists = EXPORTS.map((definition) => definition.list);
    expect(new Set(lists).size).toBe(lists.length);
    for (const definition of EXPORTS) {
      expect(PERMISSION_KEYS, definition.list).toContain(definition.permission);
    }
  });

  it("marks every column of contact details or documents as hideable from a role that must not see it", () => {
    for (const definition of EXPORTS) {
      // The staff accounts list is Admin's alone, and an email there is the login name, not a customer's contact detail.
      if (definition === (usersExport as unknown)) continue;
      for (const column of definition.columns) {
        const text = `${column.header.vi} ${column.header.en}`;
        if (PERSONAL.test(text)) {
          expect(column.maskedBy, `${definition.list}: ${text}`).toBeDefined();
        }
      }
    }
  });
});
