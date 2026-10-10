import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { contractInputSchema, contractPageSchema, contractSchema } from "@flow/shared/contracts";
import { createCustomerSchema, customerPageSchema, customerSchema, updateCustomerSchema } from "@flow/shared/customers";
import { CurrentActor } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiIdempotencyKey, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createContract, listContracts } from "../contracts/contract.service.js";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customer.service.js";

@ApiTags("customers")
@ApiErrors()
@Controller("customers")
export class CustomersController {
  /** Search by code, name, or phone (FR-CUS-002). */
  @Get()
  @ApiOptionalQuery("search", "page", "pageSize")
  @ApiResult(customerPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    const { search, page, pageSize } = queryOf(request, ["search", "page", "pageSize"]);
    return encode(customerPageSchema, await listCustomers(actor, { q: search, page, pageSize }));
  }

  @Post()
  @ApiResult(customerSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: createCustomerSchema }) body: unknown) {
    return encode(customerSchema, await createCustomer(actor, body));
  }

  @Get(":id")
  @ApiResult(customerSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(customerSchema, await getCustomer(actor, id));
  }

  @Patch(":id")
  @ApiResult(customerSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: updateCustomerSchema }) body: unknown,
  ) {
    return encode(customerSchema, await updateCustomer(actor, id, body));
  }

  @Get(":id/contracts")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(contractPageSchema)
  async contracts(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    const query = queryOf(request, ["page", "pageSize"]);
    return encode(contractPageSchema, await listContracts(actor, { ...query, customerId: id }));
  }

  /** T-015: a replay with the same key returns 200 with the original contract. */
  @Post(":id/contracts")
  @ApiIdempotencyKey()
  @ApiResult(contractSchema, 201, "Created")
  @ApiResult(contractSchema, 200, "Replayed")
  async createContract(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: contractInputSchema }) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { contract, replayed } = await createContract(actor, id, body, request.get("idempotency-key"));
    response.status(replayed ? 200 : 201);
    return encode(contractSchema, contract);
  }
}
