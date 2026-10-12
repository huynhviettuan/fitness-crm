import { Controller, Get, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { consultingReportSchema, leadAnalysisSchema } from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { exportList } from "../../platform/export/export.service.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiExcelFile, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { consultingReportExport, leadAnalysisExport, REPORT_QUERY } from "./report.export.js";
import { consultingReport, leadAnalysis } from "./report.service.js";

/** The consulting reports (brief §9, D-041, A-089 to A-093): counts and rates of a cohort. */
@ApiTags("reports")
@ApiErrors()
@Controller("reports")
export class ReportsController {
  /** The consulting dashboard per consultant and for the team: funnel, rates, compliance, first response, re-care. */
  @Get("consulting")
  @RequirePermission("report.consulting")
  @ApiOptionalQuery(...REPORT_QUERY)
  @ApiResult(consultingReportSchema)
  async consulting(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(consultingReportSchema, await consultingReport(actor, queryOf(request, REPORT_QUERY)));
  }

  @Get("consulting/export")
  @RequirePermission("report.consultingExport")
  @ApiOptionalQuery(...REPORT_QUERY)
  @ApiExcelFile()
  async exportConsulting(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, consultingReportExport, queryOf(request, REPORT_QUERY));
  }

  /** The lead analysis: the cohort by channel, source, Organic or Paid, need group, nationality, and refusal reason. */
  @Get("lead-analysis")
  @RequirePermission("report.leadAnalysis")
  @ApiOptionalQuery(...REPORT_QUERY)
  @ApiResult(leadAnalysisSchema)
  async analysis(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(leadAnalysisSchema, await leadAnalysis(actor, queryOf(request, REPORT_QUERY)));
  }

  @Get("lead-analysis/export")
  @RequirePermission("report.leadAnalysisExport")
  @ApiOptionalQuery(...REPORT_QUERY)
  @ApiExcelFile()
  async exportAnalysis(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, leadAnalysisExport, queryOf(request, REPORT_QUERY));
  }
}
