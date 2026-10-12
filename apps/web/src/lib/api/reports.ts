import "server-only";
import { consultingReportSchema, leadAnalysisSchema } from "@flow/shared/leads";
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
