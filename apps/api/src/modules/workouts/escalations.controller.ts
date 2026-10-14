import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { escalationPageSchema, escalationSchema, escalationSeenSchema } from "@flow/shared/workouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { listEscalations, markSeen } from "./escalation.service.js";

const FILTERS = ["status", "page", "pageSize"] as const;

/** The escalations raised by "Dừng + Escalation" in session logs (M7.4, brief §7.4): waiting for the manager or the Master. */
@ApiTags("workout-escalations")
@ApiErrors()
@Controller("workout/escalations")
export class WorkoutEscalationsController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(escalationPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(escalationPageSchema, await listEscalations(actor, queryOf(request, FILTERS)));
  }

  /** Marks the escalation seen with a direction; its task is done and the coach is told. Repeating it changes nothing. */
  @Post(":id/seen")
  @RequirePermission("workout.review")
  @ApiResult(escalationSchema)
  async seen(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: escalationSeenSchema }) body: unknown,
  ) {
    return encode(escalationSchema, await markSeen(actor, id, body));
  }
}
