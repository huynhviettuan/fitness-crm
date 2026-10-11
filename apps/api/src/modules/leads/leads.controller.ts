import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  leadAssignSchema,
  leadAssigneesSchema,
  leadBoardSchema,
  leadInputSchema,
  leadPageSchema,
  leadSchema,
  leadStatusChangeSchema,
  leadTimelineSchema,
  leadUpdateSchema,
} from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createLead, getLead, leadBoard, listLeads, updateLead } from "./lead.service.js";
import { assignLead, changeLeadStatus, leadAssignees, leadTimeline } from "./lead-journey.service.js";

const FILTERS = ["q", "status", "channelId", "sourceId", "needGroupId", "page", "pageSize"] as const;
const BOARD_FILTERS = ["q", "channelId", "sourceId", "needGroupId"] as const;

/** Leads (brief §4.1): people before Show, in the same record they keep as customers (D-019). */
@ApiTags("leads")
@ApiErrors()
@Controller("leads")
export class LeadsController {
  @Get()
  @RequirePermission("lead.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(leadPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(leadPageSchema, await listLeads(actor, queryOf(request, FILTERS)));
  }

  /** The Kanban board (FR-LEAD-006): a column per status, the first 30 cards of each with its total. */
  @Get("board")
  @RequirePermission("lead.view")
  @ApiOptionalQuery(...BOARD_FILTERS)
  @ApiResult(leadBoardSchema)
  async board(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(leadBoardSchema, await leadBoard(actor, queryOf(request, BOARD_FILTERS)));
  }

  /** A phone that is already someone's is PHONE_ALREADY_USED, naming that record when visible (D-019). */
  @Post()
  @RequirePermission("lead.create")
  @ApiResult(leadSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: leadInputSchema }) body: unknown) {
    return encode(leadSchema, await createLead(actor, body));
  }

  @Get(":id")
  @RequirePermission("lead.view")
  @ApiResult(leadSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadSchema, await getLead(actor, id));
  }

  /** Every field is sent; the code, stage, and status never come from the client. */
  @Patch(":id")
  @RequirePermission("lead.manage")
  @ApiResult(leadSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: leadUpdateSchema }) body: unknown,
  ) {
    return encode(leadSchema, await updateLead(actor, id, body));
  }

  /** Every status change and assignment, newest first (D-020). */
  @Get(":id/timeline")
  @RequirePermission("lead.view")
  @ApiResult(leadTimelineSchema)
  async timeline(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadTimelineSchema, await leadTimeline(actor, id));
  }

  /**
   * Moves the lead along the fixed flow (D-020); a move the flow does not allow is
   * INVALID_STATUS_TRANSITION. Booked needs a future appointment, Refused a reason.
   */
  @Post(":id/status")
  @RequirePermission("lead.manage")
  @HttpCode(200)
  @ApiResult(leadSchema)
  async changeStatus(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: leadStatusChangeSchema }) body: unknown,
  ) {
    return encode(leadSchema, await changeLeadStatus(actor, id, body));
  }

  /** Who the lead may be given to: active users of its branch who receive leads (BR-203). */
  @Get(":id/assignees")
  @RequirePermission("lead.assign")
  @ApiResult(leadAssigneesSchema)
  async assignees(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadAssigneesSchema, await leadAssignees(actor, id));
  }

  /** A manager hands the lead to someone else (BR-203); a New lead starts Consulting. */
  @Post(":id/assign")
  @RequirePermission("lead.assign")
  @HttpCode(200)
  @ApiResult(leadSchema)
  async assign(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: leadAssignSchema }) body: unknown,
  ) {
    return encode(leadSchema, await assignLead(actor, id, body));
  }
}
