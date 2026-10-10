import { Body, Controller, Get, HttpCode, Patch } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import { permissionsOf } from "@flow/shared/permissions";
import { meSchema, setLocaleSchema } from "@flow/shared/users";
import { setOwnLocale } from "../../modules/users/user.service.js";
import { trainerIdOfUser } from "../../modules/trainers/trainer.service.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { CurrentActor } from "./auth.guard.js";
import type { CurrentUser } from "./session.js";

@ApiTags("me")
@ApiErrors()
@Controller("me")
export class MeController {
  /** The signed-in user, the trainer record they act as, and what they may do (docs/07). */
  @Get()
  @ApiResult(meSchema)
  async me(@CurrentActor() user: CurrentUser) {
    return encode(meSchema, {
      ...user,
      trainerId: await trainerIdOfUser(user.id),
      permissions: permissionsOf(user.role),
    });
  }

  /** Any signed-in user may choose their own UI language. */
  @Patch("locale")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Saved" })
  async setLocale(@CurrentActor() user: CurrentUser, @Body({ schema: setLocaleSchema }) body: unknown): Promise<void> {
    await setOwnLocale(user, body);
  }
}
