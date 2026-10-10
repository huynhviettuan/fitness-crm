import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
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
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
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

  /** Confirmed payments received between two gym days, inclusive (dd/MM/yyyy). */
  @Get("collected")
  @RequirePermission("payment.view")
  @ApiOptionalQuery("from", "to")
  @ApiResult(collectedSchema)
  async collected(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(collectedSchema, { total: await collectedBetween(actor, queryOf(request, ["from", "to"])) });
  }

  /** D-035: the body carries the reason; the payment moves to the trash. */
  @Delete(":id")
  @RequirePermission("payment.delete")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Deleted to the trash" })
  async delete(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: deleteSchema }) body: unknown): Promise<void> {
    await deletePayment(actor, id, body);
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

  /** D-035: the body carries the reason; the entry moves to the trash. */
  @Delete(":id")
  @RequirePermission("cash.delete")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Deleted to the trash" })
  async delete(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: deleteSchema }) body: unknown): Promise<void> {
    await deleteCashTransaction(actor, id, body);
  }
}
