import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { cloneRoleSchema, roleInputSchema, roleListSchema, roleSchema } from "@gymcrm/shared/roles";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { cloneRole, createRole, getRole, listRoles, updateRole } from "./role.service.js";

@ApiTags("roles")
@ApiErrors()
@Controller("roles")
export class RolesController {
  /** Also for choosing a user's role. */
  @Get()
  @RequirePermission("role.manage", "user.manage")
  @ApiResult(roleListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(roleListSchema, { items: await listRoles(actor) });
  }

  @Post()
  @RequirePermission("role.manage")
  @ApiResult(roleSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: roleInputSchema }) body: unknown) {
    return encode(roleSchema, await createRole(actor, body));
  }

  @Get(":id")
  @RequirePermission("role.manage")
  @ApiResult(roleSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(roleSchema, await getRole(actor, id));
  }

  /** Replaces name, permissions, data scopes, and hidden fields. */
  @Put(":id")
  @RequirePermission("role.manage")
  @ApiResult(roleSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: roleInputSchema }) body: unknown,
  ) {
    return encode(roleSchema, await updateRole(actor, id, body));
  }

  @Post(":id/clone")
  @RequirePermission("role.manage")
  @ApiResult(roleSchema, 201, "Created")
  async clone(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: cloneRoleSchema }) body: unknown,
  ) {
    return encode(roleSchema, await cloneRole(actor, id, body));
  }
}
