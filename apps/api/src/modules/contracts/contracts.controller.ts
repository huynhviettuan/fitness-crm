import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  contractInputSchema,
  contractPageSchema,
  contractSchema,
  contractStaffListSchema,
  unapproveSchema,
} from "@flow/shared/contracts";
import { rejectSchema, submittedSchema } from "@flow/shared/approvals";
import { deleteSchema } from "@flow/shared/trash";
import { paymentInputSchema, paymentPageSchema, paymentSchema } from "@flow/shared/finance";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { submittedOrDone } from "../../platform/http/submitted.js";
import {
  ApiErrors,
  ApiIdempotencyKey,
  ApiOptionalQuery,
  ApiResult,
  ApiExcelFile,
} from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { exportList } from "../../platform/export/export.service.js";
import { contractsExport, CONTRACT_EXPORT_QUERY } from "./contract.export.js";
import { listPayments, recordPayment } from "../finance/payment.service.js";
import {
  cancelContract,
  deleteContract,
  getContract,
  listContracts,
  staffChoices,
  unapproveContract,
  updateContract,
} from "./contract.service.js";
import { activateContract, rejectContract } from "./contract-approval.service.js";

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

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("contract.export")
  @ApiOptionalQuery(...CONTRACT_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, contractsExport, queryOf(request, CONTRACT_EXPORT_QUERY));
  }

  /** Active employees of a branch (default: the user's), to name on a contract's PT and Sale shares (A-115). */
  @Get("staff")
  @RequirePermission("contract.create")
  @ApiOptionalQuery("branchId")
  @ApiResult(contractStaffListSchema)
  async staff(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(contractStaffListSchema, { items: await staffChoices(actor, queryOf(request, ["branchId"])) });
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

  /** Approves the contract's waiting request, as the inbox does (A-121); repeating it returns the state. */
  @Post(":id/activate")
  @RequirePermission("contract.approve")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async activate(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(contractSchema, await activateContract(actor, id));
  }

  /** Turns a pending contract down with a reason from `rejectReasons` (A-121). */
  @Post(":id/reject")
  @RequirePermission("contract.approve")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async reject(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: rejectSchema }) body: unknown,
  ) {
    return encode(contractSchema, await rejectContract(actor, id, body));
  }

  /** Sends an approved contract back to pending approval when no receipts or sessions depend on it (A-124). */
  @Post(":id/unapprove")
  @RequirePermission("contract.unapprove")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async unapprove(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: unapproveSchema }) body: unknown,
  ) {
    return encode(contractSchema, await unapproveContract(actor, id, body));
  }

  /** To the trash with a reason, when nothing depends on it (A-125); 202 when the deletion waits for approval. */
  @Delete(":id")
  @RequirePermission("contract.delete")
  @ApiNoContentResponse({ description: "Deleted to the trash" })
  @ApiResult(submittedSchema, 202, "Waiting for approval (D-018)")
  async remove(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deleteSchema }) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return submittedOrDone(response, await deleteContract(actor, id, body));
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
