import { Body, Controller, Get, Put, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { consultingReportSchema, leadAnalysisSchema } from "@flow/shared/leads";
import {
  cashBookSchema,
  cashOpeningInputSchema,
  cashOpeningListSchema,
  cashOpeningSchema,
  incomeExpenseSchema,
} from "@flow/shared/finance";
import { contractReportSchema, exceptionPriceReportSchema } from "@flow/shared/contracts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { exportList } from "../../platform/export/export.service.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiExcelFile, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { consultingReportExport, leadAnalysisExport, REPORT_QUERY } from "./report.export.js";
import { cashBook, incomeExpense, listCashOpenings, setCashOpening } from "./cash-book.service.js";
import { contractReport, exceptionPriceReport } from "./contract-report.service.js";
import {
  cashBookExport,
  contractReportExport,
  exceptionPriceExport,
  incomeExpenseExport,
  PERIOD_QUERY,
} from "./money-report.export.js";
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

  /** The cash book: opening, in, out, and closing per branch and method, and day by day (FR-CASH-005, AC-19). */
  @Get("cash-book")
  @RequirePermission("report.cashBook")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiResult(cashBookSchema)
  async cashBook(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(cashBookSchema, await cashBook(actor, queryOf(request, PERIOD_QUERY)));
  }

  @Get("cash-book/export")
  @RequirePermission("report.cashBookExport")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiExcelFile()
  async exportCashBook(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, cashBookExport, queryOf(request, PERIOD_QUERY));
  }

  /** The cash each branch held in each method when its books begin (A-138). */
  @Get("cash-book/openings")
  @RequirePermission("report.cashBook")
  @ApiResult(cashOpeningListSchema)
  async openings(@CurrentActor() actor: CurrentUser) {
    return encode(cashOpeningListSchema, await listCashOpenings(actor));
  }

  /** Sets one opening balance; it moves every closing balance after it, so it is Admin's and audited (A-138). */
  @Put("cash-book/openings")
  @RequirePermission("cash.opening")
  @ApiResult(cashOpeningSchema)
  async setOpening(@CurrentActor() actor: CurrentUser, @Body({ schema: cashOpeningInputSchema }) body: unknown) {
    return encode(cashOpeningSchema, await setCashOpening(actor, body));
  }

  /** Income and expense of a period by category (A-139). */
  @Get("income-expense")
  @RequirePermission("report.incomeExpense")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiResult(incomeExpenseSchema)
  async incomeExpense(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(incomeExpenseSchema, await incomeExpense(actor, queryOf(request, PERIOD_QUERY)));
  }

  @Get("income-expense/export")
  @RequirePermission("report.incomeExpenseExport")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiExcelFile()
  async exportIncomeExpense(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, incomeExpenseExport, queryOf(request, PERIOD_QUERY));
  }

  /** Revenue, debt, new and renewed contracts, and those expiring or running out, by service and tier band (A-140). */
  @Get("contracts")
  @RequirePermission("report.contracts")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiResult(contractReportSchema)
  async contracts(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(contractReportSchema, await contractReport(actor, queryOf(request, PERIOD_QUERY)));
  }

  @Get("contracts/export")
  @RequirePermission("report.contractsExport")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiExcelFile()
  async exportContracts(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, contractReportExport, queryOf(request, PERIOD_QUERY));
  }

  /** Exception prices against the tier price, by who created and who approved the contracts (A-141). */
  @Get("exception-prices")
  @RequirePermission("report.exceptionPrices")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiResult(exceptionPriceReportSchema)
  async exceptionPrices(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(exceptionPriceReportSchema, await exceptionPriceReport(actor, queryOf(request, PERIOD_QUERY)));
  }

  @Get("exception-prices/export")
  @RequirePermission("report.exceptionPricesExport")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiExcelFile()
  async exportExceptionPrices(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, exceptionPriceExport, queryOf(request, PERIOD_QUERY));
  }
}
