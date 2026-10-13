import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { sessionStatusInputSchema, sessionStatusListSchema, sessionStatusSchema } from "@flow/shared/bookings";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { listSessionStatuses, updateSessionStatus } from "./session-status.service.js";

@ApiTags("sessions")
@ApiErrors()
@Controller("session-statuses")
export class SessionStatusesController {
  /** The statuses and their rules; every signed-in user, because screens draw their labels and colors. */
  @Get()
  @AnySignedInUser()
  @ApiResult(sessionStatusListSchema)
  async list() {
    return encode(sessionStatusListSchema, await listSessionStatuses());
  }

  /** Admin changes a rule; it applies to the next status change only (T-050). */
  @Put(":code")
  @RequirePermission("config.manage")
  @ApiResult(sessionStatusSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("code") code: string,
    @Body({ schema: sessionStatusInputSchema }) body: unknown,
  ) {
    return encode(sessionStatusSchema, await updateSessionStatus(actor, code, body));
  }
}
