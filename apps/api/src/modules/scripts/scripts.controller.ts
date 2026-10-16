import { Body, Controller, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { scriptInputSchema, scriptListSchema, scriptOrderSchema, scriptSchema } from "@gymcrm/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createScript, listScripts, reorderScripts, updateScript } from "./script.service.js";

/** The consulting script library (FR-LEAD-010, A-072). */
@ApiTags("consulting-scripts")
@ApiErrors()
@Controller("consulting-scripts")
export class ScriptsController {
  /**
   * Active scripts with an answer, in order, for the lead's side panel. `includeInactive`
   * lists every script and needs `script.manage`.
   */
  @Get()
  @RequirePermission("lead.view")
  @ApiOptionalQuery("includeInactive")
  @ApiResult(scriptListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(scriptListSchema, { items: await listScripts(actor, queryOf(request, ["includeInactive"])) });
  }

  @Post()
  @RequirePermission("script.manage")
  @ApiResult(scriptSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: scriptInputSchema }) body: unknown) {
    return encode(scriptSchema, await createScript(actor, body));
  }

  /** The whole library in the new order. */
  @Put("order")
  @RequirePermission("script.manage")
  @ApiResult(scriptListSchema)
  async reorder(@CurrentActor() actor: CurrentUser, @Body({ schema: scriptOrderSchema }) body: unknown) {
    return encode(scriptListSchema, { items: await reorderScripts(actor, body) });
  }

  /** All fields are sent; a script is made inactive, never deleted. */
  @Patch(":id")
  @RequirePermission("script.manage")
  @ApiResult(scriptSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: scriptInputSchema }) body: unknown,
  ) {
    return encode(scriptSchema, await updateScript(actor, id, body));
  }
}
