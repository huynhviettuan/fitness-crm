import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ptPayoutDetailSchema, ptPayoutInputSchema, ptPayoutPageSchema } from "@flow/shared/payouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createPayout, getPayout, listPayouts } from "./payout.service.js";

const FILTERS = ["trainerId", "from", "to", "page", "pageSize"] as const;

/** PT payouts (M5.7, FR-CASH-003): an expense voucher per PT and period, and the sessions it paid. */
@ApiTags("payouts")
@ApiErrors()
@Controller("payouts")
export class PayoutsController {
  @Get()
  @RequirePermission("payout.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(ptPayoutPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(ptPayoutPageSchema, await listPayouts(actor, queryOf(request, FILTERS)));
  }

  @Get(":id")
  @RequirePermission("payout.view")
  @ApiResult(ptPayoutDetailSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(ptPayoutDetailSchema, await getPayout(actor, id));
  }

  /**
   * Pays the PT the sessions of the period not paid yet, less the paid sessions deleted since (D-027). T-015: a replay
   * with the same key returns 200 with the original payout; a voucher waiting for approval answers 202 (D-018).
   */
  @Post()
  @RequirePermission("payout.create")
  @ApiIdempotencyKey()
  @ApiResult(ptPayoutDetailSchema, 201, "Created")
  @ApiResult(ptPayoutDetailSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(ptPayoutDetailSchema, 200, "Replayed")
  async create(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: ptPayoutInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { payout, replayed } = await createPayout(actor, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : payout.approvalStatus === "PENDING" ? 202 : 201);
    return encode(ptPayoutDetailSchema, payout);
  }
}
