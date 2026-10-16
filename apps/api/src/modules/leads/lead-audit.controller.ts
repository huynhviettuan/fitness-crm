import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  consultantAuditSchema,
  criteriaInputSchema,
  criteriaListSchema,
  leadAuditSchema,
  leadsToCheckPageSchema,
  unauditedLeadsPageSchema,
} from "@gymcrm/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { consultantAudit, leadAudit, leadsToCheck, listCriteria, updateCriteria } from "./lead-audit.service.js";
import { auditQueue } from "./manager-audit.service.js";

const TO_CHECK = ["consultantId", "from", "to", "page", "pageSize"] as const;

/** The automatic consulting audit (FR-LEAD-011, A-081 to A-085): for managers. */
@ApiTags("lead-audit")
@ApiErrors()
@Controller("lead-audit")
export class LeadAuditController {
  /** Each consultant's compliance and score over the leads they are in charge of, and the team's. */
  @Get("consultants")
  @RequirePermission("lead.audit")
  @ApiOptionalQuery("from", "to")
  @ApiResult(consultantAuditSchema)
  async consultants(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(consultantAuditSchema, await consultantAudit(actor, queryOf(request, ["from", "to"])));
  }

  /** "Leads to check", most urgent first. */
  @Get("leads")
  @RequirePermission("lead.audit")
  @ApiOptionalQuery(...TO_CHECK)
  @ApiResult(leadsToCheckPageSchema)
  async leads(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(leadsToCheckPageSchema, await leadsToCheck(actor, queryOf(request, TO_CHECK)));
  }

  /** "Chưa audit": people no manager has audited yet, oldest first (A-088). */
  @Get("queue")
  @RequirePermission("lead.audit")
  @ApiOptionalQuery(...TO_CHECK)
  @ApiResult(unauditedLeadsPageSchema)
  async queue(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(unauditedLeadsPageSchema, await auditQueue(actor, queryOf(request, TO_CHECK)));
  }

  /** The audit of one lead: how each step went, its score, and its criteria. */
  @Get("leads/:id")
  @RequirePermission("lead.audit")
  @ApiResult(leadAuditSchema)
  async lead(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(leadAuditSchema, await leadAudit(actor, id));
  }

  @Get("criteria")
  @RequirePermission("lead.audit")
  @ApiResult(criteriaListSchema)
  async criteria(@CurrentActor() actor: CurrentUser) {
    return encode(criteriaListSchema, { items: await listCriteria(actor) });
  }

  /** All criteria at once: each switch and weight (1 to 10); applies to every score immediately. */
  @Put("criteria")
  @RequirePermission("config.manage")
  @ApiResult(criteriaListSchema)
  async setCriteria(@CurrentActor() actor: CurrentUser, @Body({ schema: criteriaInputSchema }) body: unknown) {
    return encode(criteriaListSchema, { items: await updateCriteria(actor, body) });
  }
}
