import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { workoutProgressSchema } from "@gymcrm/shared/workouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { getProgress } from "./progress.service.js";

/** A customer's training progress for their profile (M7.5, brief §7.5). */
@ApiTags("workout-progress")
@ApiErrors()
@Controller("workout/progress")
export class WorkoutProgressController {
  @Get(":customerId")
  @RequirePermission("workout.view")
  @ApiResult(workoutProgressSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("customerId") customerId: string) {
    return encode(workoutProgressSchema, await getProgress(actor, customerId));
  }
}
