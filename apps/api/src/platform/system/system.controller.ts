import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { systemStatusSchema } from "@gymcrm/shared/system";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { getSystemStatus } from "./system.service.js";

/** The System status page (A-321): jobs, backups, the outbox and the check-in machines, for Admin. */
@ApiTags("system")
@ApiErrors()
@Controller("system")
export class SystemController {
  @Get("status")
  @RequirePermission("system.view")
  @ApiResult(systemStatusSchema)
  async status(@CurrentActor() actor: CurrentUser) {
    return encode(systemStatusSchema, await getSystemStatus(actor));
  }
}
