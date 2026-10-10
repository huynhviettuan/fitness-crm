import { Controller, Get, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { trashPageSchema } from "@flow/shared/trash";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
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
}
