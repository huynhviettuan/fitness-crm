import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  changeRoleSchema,
  createUserSchema,
  loginEventPageSchema,
  resetPasswordSchema,
  setAccessWindowsSchema,
  setOverridesSchema,
  userBranchesBodySchema,
  setUserStatusSchema,
  userDetailSchema,
  userListSchema,
  userSchema,
} from "@flow/shared/users";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult, ApiExcelFile } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { exportList } from "../../platform/export/export.service.js";
import { usersExport, USER_EXPORT_QUERY } from "./user.export.js";
import {
  changeUserRole,
  createUser,
  getUser,
  listLoginHistory,
  listUsers,
  resetUserPassword,
  setUserAccessWindows,
  setUserBranches,
  setUserOverrides,
  setUserStatus,
} from "./user.service.js";

/** The user the path names, merged into the body the service validates. */
function forUser(userId: string, body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body) ? { ...body, userId } : body;
}

@ApiTags("users")
@ApiErrors()
@Controller("users")
export class UsersController {
  @Get()
  @RequirePermission("user.manage")
  @ApiResult(userListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(userListSchema, { items: await listUsers(actor) });
  }

  /**
   * The list as an Excel file (A-077 to A-080): the same search, filters, scope, and masks as
   * the list, every row up to `exportRowLimit`; the permission is in addition to seeing it.
   */
  @Get("export")
  @RequirePermission("user.export")
  @ApiOptionalQuery(...USER_EXPORT_QUERY)
  @ApiExcelFile()
  async export(@CurrentActor() actor: CurrentUser, @Req() request: Request, @Res() response: Response) {
    await exportList(actor, response, usersExport, queryOf(request, USER_EXPORT_QUERY));
  }

  @Post()
  @RequirePermission("user.manage")
  @ApiResult(userSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: createUserSchema }) body: unknown) {
    return encode(userSchema, await createUser(actor, body));
  }

  /** FR-PLT-001: with individual permissions and access hours. */
  @Get(":id")
  @RequirePermission("user.manage")
  @ApiResult(userDetailSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(userDetailSchema, await getUser(actor, id));
  }

  @Put(":id/role")
  @RequirePermission("user.manage")
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
  @RequirePermission("user.manage")
  @ApiResult(userSchema)
  async setStatus(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: setUserStatusSchema.omit({ userId: true }) }) body: unknown,
  ) {
    return encode(userSchema, await setUserStatus(actor, forUser(id, body)));
  }

  /** D-014: every branch or the granted ones. */
  @Put(":id/branches")
  @RequirePermission("user.manage")
  @ApiResult(userSchema)
  async setBranches(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: userBranchesBodySchema }) body: unknown,
  ) {
    return encode(userSchema, await setUserBranches(actor, forUser(id, body)));
  }

  /** FR-PLT-003: replaces the user's individual permission switches. */
  @Put(":id/overrides")
  @RequirePermission("user.manage")
  @ApiResult(userDetailSchema)
  async setOverrides(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: setOverridesSchema.omit({ userId: true }) }) body: unknown,
  ) {
    return encode(userDetailSchema, await setUserOverrides(actor, forUser(id, body)));
  }

  /** D-017: replaces the user's allowed sign-in windows; none means any time. */
  @Put(":id/access-hours")
  @RequirePermission("user.manage")
  @ApiResult(userDetailSchema)
  async setAccessHours(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: setAccessWindowsSchema.omit({ userId: true }) }) body: unknown,
  ) {
    return encode(userDetailSchema, await setUserAccessWindows(actor, forUser(id, body)));
  }

  /** D-017: sign-in attempts, newest first. */
  @Get(":id/logins")
  @RequirePermission("user.manage")
  @ApiOptionalQuery("page", "pageSize")
  @ApiResult(loginEventPageSchema)
  async logins(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    return encode(loginEventPageSchema, await listLoginHistory(actor, id, queryOf(request, ["page", "pageSize"])));
  }

  /** Also signs the user out everywhere. */
  @Put(":id/password")
  @RequirePermission("user.manage")
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
