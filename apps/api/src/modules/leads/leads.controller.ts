import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  showInputSchema,
  showResultSchema,
  leadChecklistSchema,
  stepCompleteSchema,
  stepReopenSchema,
  todayStepsSchema,
  leadAssignSchema,
  leadAssigneesSchema,
  leadBoardSchema,
  leadInputSchema,
  leadPageSchema,
  leadSchema,
  leadStatusChangeSchema,
  leadNoteInputSchema,
  leadNoteSchema,
  leadTimelineSchema,
  leadUpdateSchema,
  recarePageSchema,
} from "@gymcrm/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult, ApiExcelFile } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { exportList } from "../../platform/export/export.service.js";
import { leadsExport, LEAD_EXPORT_QUERY } from "./lead.export.js";
import { createLead, getLead, leadBoard, listLeads, updateLead } from "./lead.service.js";
import { assignLead, changeLeadStatus, leadAssignees, leadTimeline } from "./lead-journey.service.js";
import { addLeadNote } from "./lead-note.service.js";
import { completeLeadStep, leadChecklist, reopenLeadStep, todaySteps } from "./checklist.service.js";
import { noShowLead, showLead } from "./lead-outcome.service.js";
import { recareList } from "./lead-recare.service.js";

const FILTERS = ["q", "status", "channelId", "sourceId", "needGroupId", "page", "pageSize"] as const;
const RECARE_FILTERS = ["status", "picUserId", "overdue", "scope", "page", "pageSize"] as const;
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

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("lead.export")
  @ApiOptionalQuery(...LEAD_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, leadsExport, queryOf(request, LEAD_EXPORT_QUERY));
  }

  /** The Kanban board (FR-LEAD-006): a column per status, the first 30 cards of each with its total. */
  @Get("board")
  @RequirePermission("lead.view")
  @ApiOptionalQuery(...BOARD_FILTERS)
  @ApiResult(leadBoardSchema)
  async board(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(leadBoardSchema, await leadBoard(actor, queryOf(request, BOARD_FILTERS)));
  }

  /** "Việc hôm nay" (FR-LEAD-005): open consulting steps due by the end of the gym's day; `scope` mine (default) or all. */
  @Get("today")
  @RequirePermission("lead.view")
  @ApiOptionalQuery("scope")
  @ApiResult(todayStepsSchema)
  async today(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(todayStepsSchema, await todaySteps(actor, queryOf(request, ["scope"] as const)));
  }

  /**
   * "Danh sách tái chăm sóc" (FR-LEAD-007): leads in No response, Refused, or No show by
   * contact-again day (nulls last); `scope` mine (default) or all; `overdue` true for those past it.
   */
  @Get("recare")
  @RequirePermission("lead.view")
  @ApiOptionalQuery(...RECARE_FILTERS)
  @ApiResult(recarePageSchema)
  async recare(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(recarePageSchema, await recareList(actor, queryOf(request, RECARE_FILTERS)));
  }

  /**
   * The quick intake form (FR-LEAD-001). A phone that is already someone's is DUPLICATE_PHONE
   * (409) naming that record when the user may see it, so the form can offer to add the
   * inquiry to it (`POST /persons/:id/inquiries`) instead (D-019, BR-202).
   */
  @Post("intake")
  @RequirePermission("lead.create")
  @ApiResult(leadSchema, 201, "Created")
  async intake(@CurrentActor() actor: CurrentUser, @Body({ schema: leadInputSchema }) body: unknown) {
    return encode(leadSchema, await createLead(actor, body));
  }

  /** The same as `POST /leads/intake`, kept for existing callers. */
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

  /** A note on the lead (A-074): append-only, never edited or deleted. */
  @Post(":id/notes")
  @RequirePermission("lead.manage")
  @ApiResult(leadNoteSchema, 201, "Created")
  async addNote(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: leadNoteInputSchema }) body: unknown,
  ) {
    return encode(leadNoteSchema, await addLeadNote(actor, id, body));
  }

  /** Every status change, assignment, note, inquiry, and merge, newest first (D-020); also of the customer a lead became. */
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

  /** The lead's consulting checklist (FR-LEAD-004), in the version it started with. */
  @Get(":id/steps")
  @RequirePermission("lead.view")
  @ApiResult(leadChecklistSchema)
  async steps(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadChecklistSchema, await leadChecklist(actor, id));
  }

  /** Records an open step's result; a step not open, or already done, is INVALID_STATUS_TRANSITION. */
  @Post(":id/steps/:stepId/complete")
  @RequirePermission("lead.manage")
  @HttpCode(200)
  @ApiResult(leadChecklistSchema)
  async completeStep(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
    @Body({ schema: stepCompleteSchema }) body: unknown,
  ) {
    return encode(leadChecklistSchema, await completeLeadStep(actor, id, stepId, body));
  }

  /**
   * Admin removes the tick of a step done by mistake (D-054), with a reason; the step is open again and
   * the removal is in the history. A result that moved the lead cannot be removed.
   */
  @Post(":id/steps/:stepId/reopen")
  @RequirePermission("lead.untick")
  @HttpCode(200)
  @ApiResult(leadChecklistSchema)
  async reopenStep(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
    @Body({ schema: stepReopenSchema }) body: unknown,
  ) {
    return encode(leadChecklistSchema, await reopenLeadStep(actor, id, stepId, body));
  }

  /**
   * Show (D-019): the lead came in and becomes a customer in the same record, with a
   * customer code. Needs the ID document, birth date, nationality, email, phone, and the
   * customer's consent (D-042); the ID number and health note are stored encrypted.
   */
  @Post(":id/show")
  @RequirePermission("lead.manage")
  @HttpCode(200)
  @ApiResult(showResultSchema)
  async show(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: showInputSchema }) body: unknown,
  ) {
    return encode(showResultSchema, await showLead(actor, id, body));
  }

  /** A booked lead did not come: No show, due for re-care (BR-204); not booked is INVALID_STATUS_TRANSITION. */
  @Post(":id/no-show")
  @RequirePermission("lead.manage")
  @HttpCode(200)
  @ApiResult(leadSchema)
  async noShow(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadSchema, await noShowLead(actor, id));
  }
}
