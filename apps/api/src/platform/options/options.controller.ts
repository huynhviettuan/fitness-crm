import { Body, Controller, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  optionInputSchema,
  optionListSchema,
  optionOrderSchema,
  optionSchema,
  otherNoteListSchema,
} from "@gymcrm/shared/options";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { createOption, listOptions, otherNotes, reorderOptions, updateOption } from "./option.service.js";

/** Option lists (FR-PLT-005, D-016). `:key` is a list key from `@gymcrm/shared/options`. */
@ApiTags("configuration")
@ApiErrors()
@Controller("option-lists")
export class OptionListsController {
  /** Active options in order, "Khác" last; every signed-in user needs them for forms. */
  @Get(":key/options")
  @AnySignedInUser()
  @ApiOptionalQuery("includeInactive")
  @ApiResult(optionListSchema)
  async list(@Param("key") key: string, @Req() request: Request) {
    return encode(optionListSchema, { items: await listOptions(key, queryOf(request, ["includeInactive"])) });
  }

  @Post(":key/options")
  @RequirePermission("config.manage")
  @ApiResult(optionSchema, 201, "Created")
  async create(
    @CurrentActor() actor: CurrentUser,
    @Param("key") key: string,
    @Body({ schema: optionInputSchema }) body: unknown,
  ) {
    return encode(optionSchema, await createOption(actor, key, body));
  }

  /** All fields are sent; deactivating keeps the option on old records. */
  @Patch(":key/options/:id")
  @RequirePermission("config.manage")
  @ApiResult(optionSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("key") key: string,
    @Param("id") id: string,
    @Body({ schema: optionInputSchema }) body: unknown,
  ) {
    return encode(optionSchema, await updateOption(actor, key, id, body));
  }

  /** Every option but "Khác", in the new order; answers the whole list. */
  @Put(":key/order")
  @RequirePermission("config.manage")
  @ApiResult(optionListSchema)
  async reorder(
    @CurrentActor() actor: CurrentUser,
    @Param("key") key: string,
    @Body({ schema: optionOrderSchema }) body: unknown,
  ) {
    return encode(optionListSchema, { items: await reorderOptions(actor, key, body) });
  }

  @Get(":key/other-notes")
  @RequirePermission("config.manage")
  @ApiResult(otherNoteListSchema)
  async otherNotes(@CurrentActor() actor: CurrentUser, @Param("key") key: string) {
    return encode(otherNoteListSchema, { items: await otherNotes(actor, key) });
  }
}
