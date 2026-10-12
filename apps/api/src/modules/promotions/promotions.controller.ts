import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { promotionInputSchema, promotionListSchema, promotionSchema, quoteResultSchema } from "@flow/shared/promotions";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createPromotion, listPromotions, quotePrice, updatePromotion } from "./promotion.service.js";

/** Promotions and vouchers (FR-SVC-004, A-110): Admin manages them; those who sell see what is on offer. */
@ApiTags("promotions")
@ApiErrors()
@Controller("promotions")
export class PromotionsController {
  /** Staff see the promotions on offer; Admin sees every promotion and voucher, with codes. */
  @Get()
  @RequirePermission("service.view")
  @ApiOptionalQuery("kind", "onOffer")
  @ApiResult(promotionListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(promotionListSchema, { items: await listPromotions(actor, queryOf(request, ["kind", "onOffer"])) });
  }

  @Post()
  @RequirePermission("promotion.manage")
  @ApiResult(promotionSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: promotionInputSchema }) body: unknown) {
    return encode(promotionSchema, await createPromotion(actor, body));
  }

  /** All fields are sent; one is made inactive, never deleted. */
  @Patch(":id")
  @RequirePermission("promotion.manage")
  @ApiResult(promotionSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: promotionInputSchema }) body: unknown,
  ) {
    return encode(promotionSchema, await updatePromotion(actor, id, body));
  }
}

/** The price of a session count with a promotion, a voucher, and VAT (BR-301, A-110, A-111). */
@ApiTags("services")
@ApiErrors()
@Controller("services")
export class QuoteController {
  @Get(":id/quote")
  @RequirePermission("service.view")
  @ApiOptionalQuery("sessions", "startDate", "asOf", "promotionId", "voucherCode", "vatPercent")
  @ApiResult(quoteResultSchema)
  async quote(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    const query = queryOf(request, ["sessions", "startDate", "asOf", "promotionId", "voucherCode", "vatPercent"]);
    return encode(quoteResultSchema, await quotePrice(actor, id, query));
  }
}
