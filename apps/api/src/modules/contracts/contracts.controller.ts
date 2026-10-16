import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  contractHistorySchema,
  contractInputSchema,
  deactivateSchema,
  reactivateSchema,
  contractNoteSchema,
  contractPageSchema,
  contractSchema,
  contractStaffListSchema,
  unapproveSchema,
} from "@gymcrm/shared/contracts";
import { rejectSchema, submittedSchema } from "@gymcrm/shared/approvals";
import { deleteSchema } from "@gymcrm/shared/trash";
import { paymentInputSchema, paymentPageSchema, paymentSchema } from "@gymcrm/shared/finance";
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
import { contractsExport, CONTRACT_EXPORT_QUERY, CONTRACT_LIST_QUERY } from "./contract.export.js";
import { listPayments, recordPayment } from "../finance/payment.service.js";
import {
  cancelContract,
  deleteContract,
  contractHistory,
  getContract,
  listContracts,
  staffChoices,
  unapproveContract,
  updateContract,
  updateContractNote,
} from "./contract.service.js";
import { deactivateContract, reactivateContract } from "./contract-freeze.service.js";
import { activateContract, rejectContract } from "./contract-approval.service.js";

@ApiTags("contracts")
@ApiErrors()
@Controller("contracts")
export class ContractsController {
  /** Search by contract code, package, or customer. */
  @Get()
  @RequirePermission("contract.view")
  @ApiOptionalQuery(...CONTRACT_LIST_QUERY)
  @ApiResult(contractPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(contractPageSchema, await listContracts(actor, queryOf(request, CONTRACT_LIST_QUERY)));
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

  /** The package history tab: the contract's recorded changes, newest first (brief §5.3). */
  @Get(":id/history")
  @RequirePermission("contract.view")
  @ApiResult(contractHistorySchema)
  async history(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(contractHistorySchema, { items: await contractHistory(actor, id) });
  }

  /** The note can change on any contract, approved ones too (A-127). */
  @Patch(":id/note")
  @RequirePermission("contract.note")
  @ApiResult(contractSchema)
  async note(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: contractNoteSchema }) body: unknown,
  ) {
    return encode(contractSchema, await updateContractNote(actor, id, body));
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

  /** A temporary lock for review, with a reason (D-023): no booking, no check-in, no expiry while it lasts. */
  @Post(":id/deactivate")
  @RequirePermission("contract.deactivate")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async deactivate(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deactivateSchema }) body: unknown,
  ) {
    return encode(contractSchema, await deactivateContract(actor, id, body));
  }

  /** Ends the lock with a reason and the choice about the frozen days; the end date moves once (D-023). */
  @Post(":id/reactivate")
  @RequirePermission("contract.reactivate")
  @HttpCode(200)
  @ApiResult(contractSchema)
  async reactivate(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: reactivateSchema }) body: unknown,
  ) {
    return encode(contractSchema, await reactivateContract(actor, id, body));
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
