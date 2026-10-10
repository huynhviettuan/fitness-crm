import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { trainerInputSchema, trainerListSchema, trainerLoginListSchema, trainerSchema } from "@flow/shared/trainers";
import { CurrentActor } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { createTrainer, listTrainerLogins, listTrainers, updateTrainer } from "./trainer.service.js";

@ApiTags("trainers")
@ApiErrors()
@Controller("trainers")
export class TrainersController {
  @Get()
  @ApiOptionalQuery("activeOnly")
  @ApiResult(trainerListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(trainerListSchema, { items: await listTrainers(actor, queryOf(request, ["activeOnly"])) });
  }

  @Post()
  @ApiResult(trainerSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: trainerInputSchema }) body: unknown) {
    return encode(trainerSchema, await createTrainer(actor, body));
  }

  /** Logins that can be linked to a trainer record (A-010). */
  @Get("logins")
  @ApiResult(trainerLoginListSchema)
  async logins(@CurrentActor() actor: CurrentUser) {
    return encode(trainerLoginListSchema, { items: await listTrainerLogins(actor) });
  }

  /** All fields are sent: name, status, and the linked login (A-010). */
  @Patch(":id")
  @ApiResult(trainerSchema)
  async update(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: trainerInputSchema }) body: unknown) {
    return encode(trainerSchema, await updateTrainer(actor, id, body));
  }
}
