import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import {
  changeRoleSchema,
  createUserSchema,
  resetPasswordSchema,
  setUserStatusSchema,
  userListSchema,
  userSchema,
} from "@flow/shared/users";
import { CurrentActor } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { changeUserRole, createUser, listUsers, resetUserPassword, setUserStatus } from "./user.service.js";

/** The user the path names, merged into the body the service validates. */
function forUser(userId: string, body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body) ? { ...body, userId } : body;
}

@ApiTags("users")
@ApiErrors()
@Controller("users")
export class UsersController {
  @Get()
  @ApiResult(userListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(userListSchema, { items: await listUsers(actor) });
  }

  @Post()
  @ApiResult(userSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: createUserSchema }) body: unknown) {
    return encode(userSchema, await createUser(actor, body));
  }

  @Put(":id/role")
  @ApiResult(userSchema)
  async changeRole(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: changeRoleSchema.omit({ userId: true }) }) body: unknown,
  ) {
    return encode(userSchema, await changeUserRole(actor, forUser(id, body)));
  }

  /** Disabling signs the user out everywhere at once (T-017). */
  @Put(":id/status")
  @ApiResult(userSchema)
  async setStatus(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: setUserStatusSchema.omit({ userId: true }) }) body: unknown,
  ) {
    return encode(userSchema, await setUserStatus(actor, forUser(id, body)));
  }

  /** Also signs the user out everywhere. */
  @Put(":id/password")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Saved" })
  async resetPassword(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: resetPasswordSchema.omit({ userId: true }) }) body: unknown,
  ): Promise<void> {
    await resetUserPassword(actor, forUser(id, body));
  }
}
