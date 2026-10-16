import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { parametersInputSchema, parametersSchema } from "@gymcrm/shared/parameters";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { readParameters, updateParameters } from "./parameter.service.js";

/** System parameters (FR-PLT-006, T-049). */
@ApiTags("configuration")
@ApiErrors()
@Controller("parameters")
export class ParametersController {
  /** Every signed-in user: screens read them (calendar hours). */
  @Get()
  @AnySignedInUser()
  @ApiResult(parametersSchema)
  async get() {
    return encode(parametersSchema, await readParameters());
  }

  /** All values are sent. */
  @Put()
  @RequirePermission("config.manage")
  @ApiResult(parametersSchema)
  async update(@CurrentActor() actor: CurrentUser, @Body({ schema: parametersInputSchema }) body: unknown) {
    return encode(parametersSchema, await updateParameters(actor, body));
  }
}
