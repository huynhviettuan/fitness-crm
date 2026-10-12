import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { managerAuditInputSchema, managerAuditListSchema, managerAuditSchema } from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { addManagerAudit, managerAudits } from "./manager-audit.service.js";

/** The manager's audit of a lead (FR-LEAD-011, A-086, A-087). */
@ApiTags("lead-audit")
@ApiErrors()
@Controller("leads")
export class ManagerAuditController {
  /** Every grade of the lead, newest first; whoever can see the lead sees them. */
  @Get(":id/audits")
  @RequirePermission("lead.view")
  @ApiResult(managerAuditListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(managerAuditListSchema, { items: await managerAudits(actor, id) });
  }

  /** Pass or Fail with a comment and the criteria not met; each grade is kept, the latest counts. */
  @Post(":id/audits")
  @RequirePermission("lead.audit")
  @ApiResult(managerAuditSchema, 201, "Created")
  async create(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: managerAuditInputSchema }) body: unknown,
  ) {
    return encode(managerAuditSchema, await addManagerAudit(actor, id, body));
  }
}
