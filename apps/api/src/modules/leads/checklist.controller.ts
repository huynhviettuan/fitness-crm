import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { checklistInputSchema, checklistSchema } from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { getChecklist, saveChecklist } from "./checklist.service.js";

/** The consulting checklist new leads get (D-020); configuration, so `config.manage`. */
@ApiTags("leads")
@ApiErrors()
@Controller("consulting-checklist")
export class ChecklistController {
  @Get()
  @RequirePermission("config.manage")
  @ApiResult(checklistSchema)
  async get(@CurrentActor() actor: CurrentUser) {
    return encode(checklistSchema, await getChecklist(actor));
  }

  /** Every step is sent; saving makes the next version, for new leads only. */
  @Post()
  @RequirePermission("config.manage")
  @ApiResult(checklistSchema, 201, "Created")
  async save(@CurrentActor() actor: CurrentUser, @Body({ schema: checklistInputSchema }) body: unknown) {
    return encode(checklistSchema, await saveChecklist(actor, body));
  }
}
