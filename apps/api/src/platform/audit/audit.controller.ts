import { Controller, Get, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { auditPageSchema } from "@flow/shared/audit";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiExcelFile, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { exportList } from "../export/export.service.js";
import { auditExport, AUDIT_EXPORT_QUERY } from "./audit.export.js";
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

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("audit.export")
  @ApiOptionalQuery(...AUDIT_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, auditExport, queryOf(request, AUDIT_EXPORT_QUERY));
  }
}
