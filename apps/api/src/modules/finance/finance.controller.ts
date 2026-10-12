import { Body, Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse } from "@nestjs/swagger";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  cashTransactionInputSchema,
  cashTransactionPageSchema,
  cashTransactionSchema,
  collectedSchema,
  debtPageSchema,
  financeSummarySchema,
  paymentPageSchema,
} from "@flow/shared/finance";
import { deleteSchema } from "@flow/shared/trash";
import { submittedSchema } from "@flow/shared/approvals";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import {
  ApiErrors,
  ApiIdempotencyKey,
  ApiOptionalQuery,
  ApiResult,
  ApiExcelFile,
} from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { exportList } from "../../platform/export/export.service.js";
import { cashExport, CASH_EXPORT_QUERY, paymentsExport, PAYMENT_EXPORT_QUERY } from "./finance.export.js";
import { deleteCashTransaction, financeSummary, listCashTransactions, recordCashTransaction } from "./cash.service.js";
import { collectedBetween, deletePayment, listDebts, listPayments } from "./payment.service.js";

const PAYMENT_FILTERS = ["from", "to", "contractId", "customerId", "page", "pageSize"] as const;
const CASH_FILTERS = ["from", "to", "type", "page", "pageSize"] as const;

@ApiTags("finance")
@ApiErrors()
@Controller("payments")
export class PaymentsController {
  /** Contract payments, newest first (FR-PAY-002). Days are dd/MM/yyyy, inclusive. */
  @Get()
  @RequirePermission("payment.view")
  @ApiOptionalQuery(...PAYMENT_FILTERS)
  @ApiResult(paymentPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(paymentPageSchema, await listPayments(actor, queryOf(request, PAYMENT_FILTERS)));
  }

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("payment.export")
  @ApiOptionalQuery(...PAYMENT_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, paymentsExport, queryOf(request, PAYMENT_EXPORT_QUERY));
  }

  /** Confirmed payments received between two gym days, inclusive (dd/MM/yyyy). */
  @Get("collected")
  @RequirePermission("payment.view")
  @ApiOptionalQuery("from", "to")
  @ApiResult(collectedSchema)
  async collected(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(collectedSchema, { total: await collectedBetween(actor, queryOf(request, ["from", "to"])) });
  }

  /**
   * D-035: the body carries the reason; the payment moves to the trash (204), or the
   * deletion waits for approval (202 with the request, D-018).
   */
  @Delete(":id")
  @RequirePermission("payment.delete")
  @ApiNoContentResponse({ description: "Deleted to the trash" })
  @ApiResult(submittedSchema, 202, "Waiting for approval (D-018)")
  async delete(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deleteSchema }) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return submittedOrDone(response, await deletePayment(actor, id, body));
  }
}

@ApiTags("finance")
@ApiErrors()
@Controller("debts")
export class DebtsController {
  /** Contracts that still owe money, largest debt first (BR-013, A-022). */
  @Get()
  @RequirePermission("payment.view")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(debtPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(debtPageSchema, await listDebts(actor, queryOf(request, ["page", "pageSize"])));
  }
}

@ApiTags("finance")
@ApiErrors()
@Controller("cash-transactions")
export class CashTransactionsController {
  @Get()
  @RequirePermission("cash.manage")
  @ApiOptionalQuery(...CASH_FILTERS)
  @ApiResult(cashTransactionPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(cashTransactionPageSchema, await listCashTransactions(actor, queryOf(request, CASH_FILTERS)));
  }

  /** The list as an Excel file (A-077 to A-080); see `GET /payments/export`. */
  @Get("export")
  @RequirePermission("cash.export")
  @ApiOptionalQuery(...CASH_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, cashExport, queryOf(request, CASH_EXPORT_QUERY));
  }

  /** T-015: a replay with the same key returns 200 with the original transaction. */
  @Post()
  @RequirePermission("cash.manage")
  @ApiIdempotencyKey()
  @ApiResult(cashTransactionSchema, 201, "Created")
  @ApiResult(cashTransactionSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(cashTransactionSchema, 200, "Replayed")
  async record(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: cashTransactionInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { transaction, replayed } = await recordCashTransaction(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : transaction.approvalStatus === "PENDING" ? 202 : 201);
    return encode(cashTransactionSchema, transaction);
  }

  /** Totals for a period (FR-CASH-002), dd/MM/yyyy inclusive. */
  @Get("summary")
  @RequirePermission("cash.manage")
  @ApiOptionalQuery("from", "to")
  @ApiResult(financeSummarySchema)
  async summary(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(financeSummarySchema, await financeSummary(actor, queryOf(request, ["from", "to"])));
  }

  /** D-035: like deleting a payment, 204 when done or 202 when waiting for approval (D-018). */
  @Delete(":id")
  @RequirePermission("cash.delete")
  @ApiNoContentResponse({ description: "Deleted to the trash" })
  @ApiResult(submittedSchema, 202, "Waiting for approval (D-018)")
  async delete(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deleteSchema }) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return submittedOrDone(response, await deleteCashTransaction(actor, id, body));
  }
}

/** 202 with the approval request it created, or 204 when the change took effect. */
function submittedOrDone(response: Response, submitted: { approval: { id: string } } | null) {
  if (!submitted) {
    response.status(204);
    return undefined;
  }
  response.status(202);
  return encode(submittedSchema, { approval: { id: submitted.approval.id, status: "PENDING" } });
}
