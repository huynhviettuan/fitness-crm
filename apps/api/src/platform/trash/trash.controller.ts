import { Controller, Get, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { trashPageSchema } from "@gymcrm/shared/trash";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiExcelFile, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { exportList } from "../export/export.service.js";
import { trashExport, TRASH_EXPORT_QUERY } from "./trash.export.js";
import { listTrash } from "./trash.service.js";

const FILTERS = ["entityType", "from", "to", "page", "pageSize"] as const;

/**
 * The trash (FR-TRASH-002, D-035). Read-only: there is no endpoint to restore, change,
 * or purge an entry.
 */
@ApiTags("trash")
@ApiErrors()
@Controller("trash")
export class TrashController {
  /** Newest first. Days are dd/MM/yyyy, inclusive. */
  @Get()
  @RequirePermission("trash.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(trashPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(trashPageSchema, await listTrash(actor, queryOf(request, FILTERS)));
  }

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("trash.export")
  @ApiOptionalQuery(...TRASH_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, trashExport, queryOf(request, TRASH_EXPORT_QUERY));
  }
}
