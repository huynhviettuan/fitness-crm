import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { logContentSchema, logCreateSchema, logPageSchema, logSchema } from "@flow/shared/workouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createLog, getLog, listLogs, updateLog } from "./log.service.js";

const FILTERS = ["customerId", "trainerId", "page", "pageSize"] as const;

/** The session logs of PT sessions (M7.3, brief §7.3): opened from a session, filled in by the coach. */
@ApiTags("workout-logs")
@ApiErrors()
@Controller("workout/logs")
export class WorkoutLogsController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(logPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(logPageSchema, await listLogs(actor, queryOf(request, FILTERS)));
  }

  @Get(":id")
  @RequirePermission("workout.view")
  @ApiResult(logSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(logSchema, await getLog(actor, id));
  }

  /** Opens the log of a PT session, or returns the one already open; it starts from the plan. */
  @Post()
  @RequirePermission("workout.log")
  @ApiResult(logSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: logCreateSchema }) body: unknown) {
    return encode(logSchema, await createLog(actor, body));
  }

  /** Saves the three parts and the rows of the log. */
  @Put(":id")
  @RequirePermission("workout.log")
  @ApiResult(logSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: logContentSchema }) body: unknown,
  ) {
    return encode(logSchema, await updateLog(actor, id, body));
  }
}
