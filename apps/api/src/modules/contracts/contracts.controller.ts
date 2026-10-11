import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { contractInputSchema, contractPageSchema, contractSchema } from "@flow/shared/contracts";
import { paymentInputSchema, paymentPageSchema, paymentSchema } from "@flow/shared/finance";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { listPayments, recordPayment } from "../finance/payment.service.js";
import { activateContract, cancelContract, getContract, listContracts, updateContract } from "./contract.service.js";

@ApiTags("contracts")
@ApiErrors()
@Controller("contracts")
export class ContractsController {
  /** Search by contract code, package, or customer. */
  @Get()
  @RequirePermission("contract.view")
  @ApiOptionalQuery("q", "customerId", "page", "pageSize")
  @ApiResult(contractPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(
      contractPageSchema,
      await listContracts(actor, queryOf(request, ["q", "customerId", "page", "pageSize"])),
    );
  }

  @Get(":id")
  @RequirePermission("contract.view")
  @ApiResult(contractSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(contractSchema, await getContract(actor, id));
  }

  /** Drafts only; all entered fields are sent (OQ-015 interim). */
  @Patch(":id")
  @RequirePermission("contract.create")
  @ApiResult(contractSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: contractInputSchema }) body: unknown,
  ) {
    return encode(contractSchema, await updateContract(actor, id, body));
  }

  @Post(":id/activate")
  @RequirePermission("contract.approve")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async activate(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(contractSchema, await activateContract(actor, id));
  }

  /** Cancelling cascades to the contract's open bookings (D-010). */
  @Post(":id/cancel")
  @RequirePermission("contract.cancel")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async cancel(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(contractSchema, await cancelContract(actor, id));
  }

  @Get(":id/payments")
  @RequirePermission("payment.view")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(paymentPageSchema)
  async payments(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    return encode(
      paymentPageSchema,
      await listPayments(actor, { ...queryOf(request, ["page", "pageSize"]), contractId: id }),
    );
  }

  /** T-015: a replay with the same key returns 200 with the original payment. */
  @Post(":id/payments")
  @RequirePermission("payment.record")
  @ApiIdempotencyKey()
  @ApiResult(paymentSchema, 201, "Created")
  @ApiResult(paymentSchema, 202, "Waiting for approval (D-018)")
  @ApiResult(paymentSchema, 200, "Replayed")
  async recordPayment(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: paymentInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { payment, replayed } = await recordPayment(actor, id, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : payment.approvalStatus === "PENDING" ? 202 : 201);
    return encode(paymentSchema, payment);
  }
}
