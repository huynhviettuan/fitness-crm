import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { contractInputSchema, contractPageSchema, contractSchema } from "@flow/shared/contracts";
import {
  createCustomerSchema,
  customerPageSchema,
  customerSchema,
  customerStaffListSchema,
  updateCustomerSchema,
} from "@flow/shared/customers";
import { emailMessageDetailSchema, emailMessagePageSchema } from "@flow/shared/mail";
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
import { customersExport, CUSTOMER_EXPORT_QUERY } from "./customer.export.js";
import { createContract, listContracts } from "../contracts/contract.service.js";
import { getCustomerEmail, listCustomerEmails } from "../mail/mail.service.js";
import { createCustomer, getCustomer, listCustomers, staffChoices, updateCustomer } from "./customer.service.js";

@ApiTags("customers")
@ApiErrors()
@Controller("customers")
export class CustomersController {
  /**
   * Search by code, name, or phone (FR-CUS-002); filters of FR-CUS-003 (A-075): branch,
   * staff in charge, registration days (dd/MM/yyyy), birthday month, and no email.
   */
  @Get()
  @RequirePermission("customer.view")
  @ApiOptionalQuery(
    "search",
    "page",
    "pageSize",
    "branchId",
    "staffId",
    "registeredFrom",
    "registeredTo",
    "birthdayMonth",
    "noEmail",
  )
  @ApiResult(customerPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    const { search, ...rest } = queryOf(request, [
      "search",
      "page",
      "pageSize",
      "branchId",
      "staffId",
      "registeredFrom",
      "registeredTo",
      "birthdayMonth",
      "noEmail",
    ]);
    return encode(customerPageSchema, await listCustomers(actor, { q: search, ...rest }));
  }

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("customer.export")
  @ApiOptionalQuery(...CUSTOMER_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, customersExport, queryOf(request, CUSTOMER_EXPORT_QUERY));
  }

  /** Active users of the user's branches: who can be in charge of a customer, and the staff filter (A-071). */
  @Get("staff")
  @RequirePermission("customer.view")
  @ApiResult(customerStaffListSchema)
  async staff(@CurrentActor() actor: CurrentUser) {
    return encode(customerStaffListSchema, { items: await staffChoices(actor) });
  }

  @Post()
  @RequirePermission("customer.manage")
  @ApiResult(customerSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: createCustomerSchema }) body: unknown) {
    return encode(customerSchema, await createCustomer(actor, body));
  }

  @Get(":id")
  @RequirePermission("customer.view")
  @ApiResult(customerSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(customerSchema, await getCustomer(actor, id));
  }

  /**
   * 200 when every change took effect; 202 when a change of name, phone, or email waits
   * for approval (D-018) — the other fields changed, and `pendingIdentity` shows it.
   */
  @Patch(":id")
  @RequirePermission("customer.manage")
  @ApiResult(customerSchema)
  @ApiResult(customerSchema, 202, "Identity change waiting for approval (D-018)")
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: updateCustomerSchema }) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { customer, approval } = await updateCustomer(actor, id, body);
    response.status(approval ? 202 : 200);
    return encode(customerSchema, customer);
  }

  @Get(":id/contracts")
  @RequirePermission("contract.view")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(contractPageSchema)
  async contracts(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    const query = queryOf(request, ["page", "pageSize"]);
    return encode(contractPageSchema, await listContracts(actor, { ...query, customerId: id }));
  }

  /** The emails sent to this customer, newest first, with their status (FR-MAIL-003). */
  @Get(":id/emails")
  @RequirePermission("customer.view")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(emailMessagePageSchema)
  async emails(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    return encode(emailMessagePageSchema, await listCustomerEmails(actor, id, queryOf(request, ["page", "pageSize"])));
  }

  /** One email with its subject and body, to see what the customer was told (A-317). */
  @Get(":id/emails/:emailId")
  @RequirePermission("customer.view")
  @ApiResult(emailMessageDetailSchema)
  async email(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Param("emailId") emailId: string) {
    return encode(emailMessageDetailSchema, await getCustomerEmail(actor, id, emailId));
  }

  /** T-015: a replay with the same key returns 200 with the original contract. */
  @Post(":id/contracts")
  @RequirePermission("contract.create")
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
