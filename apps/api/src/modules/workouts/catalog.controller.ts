import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  areaInputSchema,
  areaListSchema,
  equipmentInputSchema,
  equipmentListSchema,
  equipmentSchema,
  areaSchema,
  exerciseInputSchema,
  exercisePageSchema,
  exerciseSchema,
  stageInputSchema,
  stageListSchema,
  stageSchema,
} from "@flow/shared/workouts";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  createArea,
  createEquipment,
  createExercise,
  createStage,
  getExercise,
  listAreas,
  listEquipment,
  listExercises,
  listStages,
  updateArea,
  updateEquipment,
  updateExercise,
  updateStage,
} from "./catalog.service.js";

const INACTIVE = ["includeInactive"] as const;
const EXERCISE_FILTERS = ["q", "areaId", "equipmentId", "kind", "includeInactive", "page", "pageSize"] as const;

/** The equipment of the workout catalog (M7.1, brief §7.1). */
@ApiTags("workout-catalog")
@ApiErrors()
@Controller("workout/equipment")
export class WorkoutEquipmentController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...INACTIVE)
  @ApiResult(equipmentListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(equipmentListSchema, await listEquipment(actor, queryOf(request, INACTIVE)));
  }

  @Post()
  @RequirePermission("workout.catalog")
  @ApiResult(equipmentSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: equipmentInputSchema }) body: unknown) {
    return encode(equipmentSchema, await createEquipment(actor, body));
  }

  @Patch(":id")
  @RequirePermission("workout.catalog")
  @ApiResult(equipmentSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: equipmentInputSchema }) body: unknown,
  ) {
    return encode(equipmentSchema, await updateEquipment(actor, id, body));
  }
}

/** The body areas, as a tree in reading order. */
@ApiTags("workout-catalog")
@ApiErrors()
@Controller("workout/areas")
export class WorkoutAreasController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...INACTIVE)
  @ApiResult(areaListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(areaListSchema, await listAreas(actor, queryOf(request, INACTIVE)));
  }

  @Post()
  @RequirePermission("workout.catalog")
  @ApiResult(areaSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: areaInputSchema }) body: unknown) {
    return encode(areaSchema, await createArea(actor, body));
  }

  @Patch(":id")
  @RequirePermission("workout.catalog")
  @ApiResult(areaSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: areaInputSchema }) body: unknown,
  ) {
    return encode(areaSchema, await updateArea(actor, id, body));
  }
}

/** The exercises: Strength or Cardio, with an area, equipment and a video link. */
@ApiTags("workout-catalog")
@ApiErrors()
@Controller("workout/exercises")
export class WorkoutExercisesController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...EXERCISE_FILTERS)
  @ApiResult(exercisePageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(exercisePageSchema, await listExercises(actor, queryOf(request, EXERCISE_FILTERS)));
  }

  @Get(":id")
  @RequirePermission("workout.view")
  @ApiResult(exerciseSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(exerciseSchema, await getExercise(actor, id));
  }

  @Post()
  @RequirePermission("workout.catalog")
  @ApiResult(exerciseSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: exerciseInputSchema }) body: unknown) {
    return encode(exerciseSchema, await createExercise(actor, body));
  }

  @Patch(":id")
  @RequirePermission("workout.catalog")
  @ApiResult(exerciseSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: exerciseInputSchema }) body: unknown,
  ) {
    return encode(exerciseSchema, await updateExercise(actor, id, body));
  }
}

/** The stages (phases) of a plan, e.g. Rehab. */
@ApiTags("workout-catalog")
@ApiErrors()
@Controller("workout/stages")
export class WorkoutStagesController {
  @Get()
  @RequirePermission("workout.view")
  @ApiOptionalQuery(...INACTIVE)
  @ApiResult(stageListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(stageListSchema, await listStages(actor, queryOf(request, INACTIVE)));
  }

  @Post()
  @RequirePermission("workout.catalog")
  @ApiResult(stageSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: stageInputSchema }) body: unknown) {
    return encode(stageSchema, await createStage(actor, body));
  }

  @Patch(":id")
  @RequirePermission("workout.catalog")
  @ApiResult(stageSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: stageInputSchema }) body: unknown,
  ) {
    return encode(stageSchema, await updateStage(actor, id, body));
  }
}
