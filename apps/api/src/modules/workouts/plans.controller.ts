import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  planContentSchema,
  planCreateSchema,
  planPageSchema,
  planReviewSchema,
  planSchema,
} from "@flow/shared/workouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createPlan, getPlan, listPlans, reviewPlan, revisePlan, submitPlan, updatePlan } from "./plan.service.js";

const FILTERS = ["kind", "status", "customerId", "trainerId", "q", "includeInactive", "page", "pageSize"] as const;

/** Workout plan templates and customers' plans (M7.2, brief §7.2): written as drafts, approved by the Master, then revised. */
@ApiTags("workout-plans")
@ApiErrors()
@Controller("workout/plans")
export class WorkoutPlansController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(planPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(planPageSchema, await listPlans(actor, queryOf(request, FILTERS)));
  }

  @Get(":id")
  @RequirePermission("workout.view")
  @ApiResult(planSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(planSchema, await getPlan(actor, id));
  }

  /** A template, or a customer's plan blank or from an approved template. Always a draft. */
  @Post()
  @RequirePermission("workout.plan")
  @ApiResult(planSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: planCreateSchema }) body: unknown) {
    return encode(planSchema, await createPlan(actor, body));
  }

  /** Saves the header and everything under it; only a draft or a rejected plan (`409 PLAN_NOT_EDITABLE`). */
  @Put(":id")
  @RequirePermission("workout.plan")
  @ApiResult(planSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: planContentSchema }) body: unknown,
  ) {
    return encode(planSchema, await updatePlan(actor, id, body));
  }

  /** Sends the draft to the Master; approved at once when the matrix does not require it. */
  @Post(":id/submit")
  @RequirePermission("workout.plan")
  @ApiResult(planSchema)
  async submit(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(planSchema, await submitPlan(actor, id));
  }

  /** Starts a revision of an approved plan: a draft copy that replaces it when approved. */
  @Post(":id/revise")
  @RequirePermission("workout.plan")
  @ApiResult(planSchema, 201, "Created")
  async revise(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(planSchema, await revisePlan(actor, id));
  }

  /** The coach's or the Master's evaluation and note. */
  @Put(":id/review")
  @RequirePermission("workout.view")
  @ApiResult(planSchema)
  async review(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: planReviewSchema }) body: unknown,
  ) {
    return encode(planSchema, await reviewPlan(actor, id, body));
  }
}
