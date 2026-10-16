import "server-only";
import { contractReportSchema, exceptionPriceReportSchema } from "@gymcrm/shared/contracts";
import {
  cashBookSchema,
  cashOpeningListSchema,
  cashOpeningSchema,
  incomeExpenseSchema,
  type CashOpeningInput,
} from "@gymcrm/shared/finance";
import { consultingReportSchema, leadAnalysisSchema } from "@gymcrm/shared/leads";
import {
  bookingReportPageSchema,
  overviewSchema,
  ptRevenueReportSchema,
  taskReportSchema,
} from "@gymcrm/shared/reports";
import { api, query, read } from "./client";

// The consulting reports (brief §9, D-041; A-089 to A-094).

/** The cohort of a report: leads created in a period (dd/MM/yyyy), in a branch, of a person in charge. */
export type ReportParams = { from?: string; to?: string; branchId?: string; staffId?: string };

export async function getConsultingReport(params: ReportParams) {
  return read(
    consultingReportSchema,
    (await api()).GET("/api/v1/reports/consulting", { params: { query: query(params) } }),
  );
}

export async function getLeadAnalysis(params: ReportParams) {
  return read(
    leadAnalysisSchema,
    (await api()).GET("/api/v1/reports/lead-analysis", { params: { query: query(params) } }),
  );
}

// The money and contract reports (brief §8.1, §9; A-138 to A-141).

/** The period (dd/MM/yyyy, inclusive; this month when empty) and branch of a money report. */
export type PeriodParams = { from?: string; to?: string; branchId?: string };

export async function getCashBook(params: PeriodParams) {
  return read(cashBookSchema, (await api()).GET("/api/v1/reports/cash-book", { params: { query: query(params) } }));
}

export async function listCashOpenings() {
  return read(cashOpeningListSchema, (await api()).GET("/api/v1/reports/cash-book/openings"));
}

/** Sets the cash a branch held in a payment method when its books begin (Admin, audited). */
export async function setCashOpening(input: CashOpeningInput) {
  return read(cashOpeningSchema, (await api()).PUT("/api/v1/reports/cash-book/openings", { body: input }));
}

export async function getIncomeExpense(params: PeriodParams) {
  return read(
    incomeExpenseSchema,
    (await api()).GET("/api/v1/reports/income-expense", { params: { query: query(params) } }),
  );
}

export async function getContractReport(params: PeriodParams) {
  return read(
    contractReportSchema,
    (await api()).GET("/api/v1/reports/contracts", { params: { query: query(params) } }),
  );
}

export async function getExceptionPrices(params: PeriodParams) {
  return read(
    exceptionPriceReportSchema,
    (await api()).GET("/api/v1/reports/exception-prices", { params: { query: query(params) } }),
  );
}

// The PT revenue allocation, the booking report, and the overview dashboard (brief §6.5, §9; M5.6).

/** The period and branch of a report plus the PT it is about. */
export type TrainerParams = PeriodParams & { trainerId?: string };

export async function getPtRevenue(params: TrainerParams) {
  return read(
    ptRevenueReportSchema,
    (await api()).GET("/api/v1/reports/pt-revenue", { params: { query: query(params) } }),
  );
}

export type BookingReportParams = TrainerParams & {
  type?: "PT" | "BURN_SHOW";
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function getBookingReport(params: BookingReportParams) {
  return read(
    bookingReportPageSchema,
    (await api()).GET("/api/v1/reports/bookings", { params: { query: query(params) } }),
  );
}

export async function getOverview(params: PeriodParams) {
  return read(overviewSchema, (await api()).GET("/api/v1/reports/overview", { params: { query: query(params) } }));
}

/** The tasks report (brief §9, FR-TASK-006): tasks given, done on time, done late and overdue. */
export async function getTaskReport(params: PeriodParams) {
  return read(taskReportSchema, (await api()).GET("/api/v1/reports/tasks", { params: { query: query(params) } }));
}
