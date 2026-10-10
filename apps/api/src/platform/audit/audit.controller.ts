import { Controller, Get, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { auditPageSchema } from "@flow/shared/audit";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { listAuditEvents } from "./audit.service.js";

const FILTERS = ["entityType", "entityId", "actorUserId", "from", "to", "page", "pageSize"] as const;

/** The action history (FR-PLT-008). Read-only. */
@ApiTags("audit")
@ApiErrors()
@Controller("audit-events")
export class AuditEventsController {
  /** Newest first. Days are dd/MM/yyyy, inclusive. */
  @Get()
  @RequirePermission("audit.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(auditPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(auditPageSchema, await listAuditEvents(actor, queryOf(request, FILTERS)));
  }
}
