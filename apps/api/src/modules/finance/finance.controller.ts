import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
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
  paymentSchema,
  voidSchema,
} from "@flow/shared/finance";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { financeSummary, listCashTransactions, recordCashTransaction, voidCashTransaction } from "./cash.service.js";
import { collectedBetween, listDebts, listPayments, voidPayment } from "./payment.service.js";

const PAYMENT_FILTERS = ["from", "to", "status", "contractId", "customerId", "page", "pageSize"] as const;
const CASH_FILTERS = ["from", "to", "type", "status", "page", "pageSize"] as const;

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

  /** Confirmed payments received between two gym days, inclusive (dd/MM/yyyy). */
  @Get("collected")
  @RequirePermission("payment.view")
  @ApiOptionalQuery("from", "to")
  @ApiResult(collectedSchema)
  async collected(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(collectedSchema, { total: await collectedBetween(actor, queryOf(request, ["from", "to"])) });
  }

  /** A-008: the body carries the reason; a repeat returns the voided payment. */
  @Post(":id/void")
  @RequirePermission("payment.void")
  @HttpCode(200)
  @ApiResult(paymentSchema)
  async void(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: voidSchema }) body: unknown) {
    return encode(paymentSchema, await voidPayment(actor, id, body));
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

  /** T-015: a replay with the same key returns 200 with the original transaction. */
  @Post()
  @RequirePermission("cash.manage")
  @ApiIdempotencyKey()
  @ApiResult(cashTransactionSchema, 201, "Created")
  @ApiResult(cashTransactionSchema, 200, "Replayed")
  async record(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: cashTransactionInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { transaction, replayed } = await recordCashTransaction(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : 201);
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

  /** A-009: the body carries the reason; a repeat returns the voided transaction. */
  @Post(":id/void")
  @RequirePermission("cash.manage")
  @HttpCode(200)
  @ApiResult(cashTransactionSchema)
  async void(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: voidSchema }) body: unknown) {
    return encode(cashTransactionSchema, await voidCashTransaction(actor, id, body));
  }
}
