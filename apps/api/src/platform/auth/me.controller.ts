import { Body, Controller, Get, HttpCode, Patch } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import { PERMISSION_KEYS } from "@flow/shared/permissions";
import { meSchema, setLocaleSchema } from "@flow/shared/users";
import { setOwnLocale } from "../../modules/users/user.service.js";
import { usableBranches } from "../branches/branch.service.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { AnySignedInUser, CurrentActor } from "./auth.guard.js";
import type { CurrentUser } from "./session.js";

@ApiTags("me")
@ApiErrors()
@Controller("me")
export class MeController {
  /**
   * The signed-in user, the trainer record they act as, their effective permissions,
   * branches, and hidden fields (docs/07). The web app hides what the user cannot use;
   * the API checks every request itself (T-046).
   */
  @Get()
  @AnySignedInUser()
  @ApiResult(meSchema)
  async me(@CurrentActor() user: CurrentUser) {
    return encode(meSchema, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      locale: user.locale,
      employeeId: user.employeeId,
      permissions: PERMISSION_KEYS.filter((permission) => user.permissions.has(permission)),
      dataScopes: user.scopes,
      allBranches: user.allBranches,
      branches: await usableBranches(user),
      maskedFields: [...user.masks],
    });
  }

  /** Any signed-in user may choose their own UI language. */
  @Patch("locale")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Saved" })
  async setLocale(@CurrentActor() user: CurrentUser, @Body({ schema: setLocaleSchema }) body: unknown): Promise<void> {
    await setOwnLocale(user, body);
  }
}
