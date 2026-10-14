import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { holdInputSchema, renewalInputSchema, voucherPageSchema, voucherSchema } from "@flow/shared/changes";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { getVoucher, listVouchers, raiseHold, raiseRenewal } from "./voucher.service.js";

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
}
