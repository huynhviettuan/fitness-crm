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
import { bookingReportPageSchema, overviewSchema, ptRevenueReportSchema, taskReportSchema } from "@flow/shared/reports";
import { workoutDashboardSchema, workoutDrillSchema } from "@flow/shared/workouts";
import { workoutDashboard, workoutDrill } from "../workouts/dashboard.service.js";
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
import { bookingReport, overview, ptRevenueReport } from "./pt-report.service.js";
import { BOOKING_REPORT_QUERY, bookingReportExport, PT_REVENUE_QUERY, ptRevenueExport } from "./pt-report.export.js";
import { consultingReport, leadAnalysis } from "./report.service.js";
import { TASK_REPORT_QUERY, taskReportExport } from "./task-report.export.js";
import { taskReport } from "./task-report.service.js";

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

  /** The tasks given, done on time, done late and overdue, by person and by department (FR-TASK-006). */
  @Get("tasks")
  @RequirePermission("report.tasks")
  @ApiOptionalQuery(...TASK_REPORT_QUERY)
  @ApiResult(taskReportSchema)
  async tasks(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(taskReportSchema, await taskReport(actor, queryOf(request, TASK_REPORT_QUERY)));
  }

  @Get("tasks/export")
  @RequirePermission("report.tasksExport")
  @ApiOptionalQuery(...TASK_REPORT_QUERY)
  @ApiExcelFile()
  async exportTasks(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, taskReportExport, queryOf(request, TASK_REPORT_QUERY));
  }

  /** The PT revenue allocation: a row per PT and contract with the sessions that credited the PT (D-032, A-166). */
  @Get("pt-revenue")
  @RequirePermission("report.ptRevenue")
  @ApiOptionalQuery(...PT_REVENUE_QUERY)
  @ApiResult(ptRevenueReportSchema)
  async ptRevenue(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(ptRevenueReportSchema, await ptRevenueReport(actor, queryOf(request, PT_REVENUE_QUERY)));
  }

  @Get("pt-revenue/export")
  @RequirePermission("report.ptRevenueExport")
  @ApiOptionalQuery(...PT_REVENUE_QUERY)
  @ApiExcelFile()
  async exportPtRevenue(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, ptRevenueExport, queryOf(request, PT_REVENUE_QUERY));
  }

  /** The PT sessions of a period, one row each, filtered by type and status (brief §9, A-171). */
  @Get("bookings")
  @RequirePermission("report.bookings")
  @ApiOptionalQuery(...BOOKING_REPORT_QUERY)
  @ApiResult(bookingReportPageSchema)
  async bookings(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(bookingReportPageSchema, await bookingReport(actor, queryOf(request, BOOKING_REPORT_QUERY)));
  }

  @Get("bookings/export")
  @RequirePermission("report.bookingsExport")
  @ApiOptionalQuery(...BOOKING_REPORT_QUERY)
  @ApiExcelFile()
  async exportBookings(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, bookingReportExport, queryOf(request, BOOKING_REPORT_QUERY));
  }

  /** The overview dashboard: leads, members training, PTs, contracts ending soon, sessions by hour, revenue (A-172). */
  @Get("overview")
  @RequirePermission("report.overview")
  @ApiOptionalQuery(...PERIOD_QUERY)
  @ApiResult(overviewSchema)
  async overview(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(overviewSchema, await overview(actor, queryOf(request, PERIOD_QUERY)));
  }

  /** The weekly workout dashboard: Flag and Action shares, customers with a Flag other than Normal, the week before, escalations waiting. */
  @Get("workouts")
  @RequirePermission("report.workouts")
  @ApiOptionalQuery("week", "branchId")
  @ApiResult(workoutDashboardSchema)
  async workouts(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(workoutDashboardSchema, await workoutDashboard(actor, queryOf(request, ["week", "branchId"])));
  }

  /** The sets behind one share of the dashboard, newest session first. */
  @Get("workouts/sets")
  @RequirePermission("report.workouts")
  @ApiOptionalQuery("week", "branchId", "kind", "optionId", "page", "pageSize")
  @ApiResult(workoutDrillSchema)
  async workoutSets(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    const filters = ["week", "branchId", "kind", "optionId", "page", "pageSize"] as const;
    return encode(workoutDrillSchema, await workoutDrill(actor, queryOf(request, filters)));
  }
}
