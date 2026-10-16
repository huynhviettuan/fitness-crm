import { Body, Controller, Get, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  priceLookupSchema,
  quickPackagesInputSchema,
  serviceDetailSchema,
  serviceInputSchema,
  serviceListSchema,
  tiersInputSchema,
} from "@gymcrm/shared/services";
import { attachFileSchema } from "@gymcrm/shared/files";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  createService,
  getService,
  listServices,
  lookupPrice,
  saveQuickPackages,
  saveTiers,
  setServiceImage,
  updateService,
} from "./service.service.js";

/** Services and their price tiers (FR-SVC-001 to FR-SVC-003, D-021): read by those who sell, edited by Admin. */
@ApiTags("services")
@ApiErrors()
@Controller("services")
export class ServicesController {
  /** `onSale` lists only the services that can be sold today, for the contract form. */
  @Get()
  @RequirePermission("service.view")
  @ApiOptionalQuery("kind", "branchId", "onSale")
  @ApiResult(serviceListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(serviceListSchema, {
      items: await listServices(actor, queryOf(request, ["kind", "branchId", "onSale"])),
    });
  }

  @Post()
  @RequirePermission("service.manage")
  @ApiResult(serviceDetailSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: serviceInputSchema }) body: unknown) {
    return encode(serviceDetailSchema, await createService(actor, body));
  }

  @Get(":id")
  @RequirePermission("service.view")
  @ApiResult(serviceDetailSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(serviceDetailSchema, await getService(actor, id));
  }

  /** All fields are sent; a service is made inactive, never deleted. */
  @Patch(":id")
  @RequirePermission("service.manage")
  @ApiResult(serviceDetailSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: serviceInputSchema }) body: unknown,
  ) {
    return encode(serviceDetailSchema, await updateService(actor, id, body));
  }

  /** Sets the picture from an uploaded file, or takes it off with null (M4.1b, A-143). */
  @Put(":id/image")
  @RequirePermission("service.manage")
  @ApiResult(serviceDetailSchema)
  async image(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: attachFileSchema }) body: unknown,
  ) {
    return encode(serviceDetailSchema, await setServiceImage(actor, id, body));
  }

  /** A new version of the whole tier set, from a day on (BR-301). */
  @Put(":id/tiers")
  @RequirePermission("service.manage")
  @ApiResult(serviceDetailSchema)
  async saveTiers(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: tiersInputSchema }) body: unknown,
  ) {
    return encode(serviceDetailSchema, await saveTiers(actor, id, body));
  }

  @Put(":id/quick-packages")
  @RequirePermission("service.manage")
  @ApiResult(serviceDetailSchema)
  async saveQuickPackages(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: quickPackagesInputSchema }) body: unknown,
  ) {
    return encode(serviceDetailSchema, await saveQuickPackages(actor, id, body));
  }

  /** The unit price, total, display name, and end date of a session count (BR-301, AC-10). */
  @Get(":id/lookup")
  @RequirePermission("service.view")
  @ApiOptionalQuery("sessions", "startDate", "asOf")
  @ApiResult(priceLookupSchema)
  async lookup(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Req() request: Request) {
    return encode(priceLookupSchema, await lookupPrice(actor, id, queryOf(request, ["sessions", "startDate", "asOf"])));
  }
}
