import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  branchTransferInputSchema,
  exchangeInputSchema,
  holdInputSchema,
  renewalInputSchema,
  transferInputSchema,
  voucherPageSchema,
  voucherSchema,
} from "@flow/shared/changes";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  getVoucher,
  listVouchers,
  raiseBranchTransfer,
  raiseConversion,
  raiseHold,
  raiseRenewal,
  raiseTransfer,
  raiseUpgrade,
} from "./voucher.service.js";

const FILTERS = ["contractId", "customerId", "kind", "status", "page", "pageSize"] as const;

/** The change vouchers of contracts (M8, brief §5.6, D-024): raised against an approved contract, then approved. */
@ApiTags("contract-changes")
@ApiErrors()
@Controller("contract-changes")
export class ContractChangesController {
  @Get()
  @RequirePermission("contract.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(voucherPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(voucherPageSchema, await listVouchers(actor, queryOf(request, FILTERS)));
  }

  @Get(":id")
  @RequirePermission("contract.view")
  @ApiResult(voucherSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(voucherSchema, await getVoucher(actor, id));
  }

  /** A renewal adds months, days or sessions and an amount; T-015: a replay with the same key answers 200. */
  @Post("renewals")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async renewal(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: renewalInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseRenewal(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }

  /** A hold stops the contract for some days, which are added to its end. */
  @Post("holds")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async hold(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: holdInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseHold(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }

  /** An upgrade exchanges what is left of the package for a new service (A-227). */
  @Post("upgrades")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async upgrade(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: exchangeInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseUpgrade(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }

  /** A conversion exchanges what is left of the package for another service or contract (A-227). */
  @Post("conversions")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async conversion(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: exchangeInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseConversion(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }

  /** A transfer gives the sessions left to another customer (A-232). */
  @Post("transfers")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async transfer(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: transferInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseTransfer(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }

  /** A branch transfer moves the contract to another branch for a fee (A-235). */
  @Post("branch-transfers")
  @RequirePermission("contract.change")
  @ApiIdempotencyKey()
  @ApiResult(voucherSchema, 201, "Created and applied")
  @ApiResult(voucherSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(voucherSchema, 200, "Replayed")
  async branchTransfer(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: branchTransferInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { voucher, replayed } = await raiseBranchTransfer(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : voucher.status === "PENDING" ? 202 : 201);
    return encode(voucherSchema, voucher);
  }
}
