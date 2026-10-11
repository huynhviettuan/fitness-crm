import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  approvalRequestPageSchema,
  approvalRuleInputSchema,
  approvalRuleListSchema,
  approvalRuleSchema,
  approvalSummarySchema,
  rejectSchema,
} from "@flow/shared/approvals";
import { approvalSummary, listApprovals, listRules, updateRule } from "../../platform/approvals/approval.engine.js";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { approveRequest, rejectRequest } from "./approval.service.js";

const FILTERS = ["view", "status", "page", "pageSize"] as const;

/**
 * The approvals inbox (FR-PLT-007). Any signed-in user has one: who may decide a
 * request is the approval matrix's business, checked per request (D-018).
 */
@ApiTags("approvals")
@ApiErrors()
@Controller("approvals")
export class ApprovalsController {
  /** `view`: toDecide (default), mine, or all (approval.manage). Oldest first to decide. */
  @Get()
  @AnySignedInUser()
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(approvalRequestPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(approvalRequestPageSchema, await listApprovals(actor, queryOf(request, FILTERS)));
  }

  @Get("summary")
  @AnySignedInUser()
  @ApiResult(approvalSummarySchema)
  async summary(@CurrentActor() actor: CurrentUser) {
    return encode(approvalSummarySchema, await approvalSummary(actor));
  }

  /** Never by the submitter (APPROVAL_OWN_REQUEST); a decided request is APPROVAL_NOT_PENDING. */
  @Post(":id/approve")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Approved; the change took effect" })
  async approve(@CurrentActor() actor: CurrentUser, @Param("id") id: string): Promise<void> {
    await approveRequest(actor, id);
  }

  @Post(":id/reject")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Rejected; nothing changed" })
  async reject(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: rejectSchema }) body: unknown,
  ): Promise<void> {
    await rejectRequest(actor, id, body);
  }
}

/** The approval matrix (D-018): which actions need approval, and who approves. */
@ApiTags("approvals")
@ApiErrors()
@Controller("approval-rules")
export class ApprovalRulesController {
  @Get()
  @RequirePermission("approval.manage")
  @ApiResult(approvalRuleListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(approvalRuleListSchema, { items: await listRules(actor) });
  }

  /** All fields are sent; takes effect at once, also for requests already pending. */
  @Put(":action")
  @RequirePermission("approval.manage")
  @ApiResult(approvalRuleSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("action") action: string,
    @Body({ schema: approvalRuleInputSchema }) body: unknown,
  ) {
    return encode(approvalRuleSchema, await updateRule(actor, action, body));
  }
}
