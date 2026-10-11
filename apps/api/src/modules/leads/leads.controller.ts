import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { leadInputSchema, leadPageSchema, leadSchema, leadUpdateSchema } from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createLead, getLead, listLeads, updateLead } from "./lead.service.js";

const FILTERS = ["q", "status", "channelId", "sourceId", "needGroupId", "page", "pageSize"] as const;

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
  async update(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: leadUpdateSchema }) body: unknown) {
    return encode(leadSchema, await updateLead(actor, id, body));
  }
}
