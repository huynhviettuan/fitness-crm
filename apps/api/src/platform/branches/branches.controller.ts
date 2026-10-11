import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { branchInputSchema, branchListSchema, branchSchema } from "@flow/shared/branches";
import { CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { createBranch, listBranches, updateBranch } from "./branch.service.js";

@ApiTags("branches")
@ApiErrors()
@Controller("branches")
export class BranchesController {
  @Get()
  @RequirePermission("branch.manage")
  @ApiResult(branchListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(branchListSchema, { items: await listBranches(actor) });
  }

  @Post()
  @RequirePermission("branch.manage")
  @ApiResult(branchSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: branchInputSchema }) body: unknown) {
    return encode(branchSchema, await createBranch(actor, body));
  }

  /** All fields are sent; deactivating keeps the branch's records (D-035). */
  @Patch(":id")
  @RequirePermission("branch.manage")
  @ApiResult(branchSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: branchInputSchema }) body: unknown,
  ) {
    return encode(branchSchema, await updateBranch(actor, id, body));
  }
}
