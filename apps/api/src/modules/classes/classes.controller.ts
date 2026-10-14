import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  classInputSchema,
  classListSchema,
  classSchema,
  classSessionListSchema,
  classSessionSchema,
  classUpdateSchema,
  enrollSchema,
  markAttendanceSchema,
} from "@flow/shared/classes";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  createClass,
  enrollCustomer,
  getClassSession,
  listClassSessions,
  listClasses,
  markAttendance,
  removeEnrollment,
  updateClass,
} from "./class.service.js";

const SESSION_FILTERS = ["date", "days", "branchId", "coachId", "classId"] as const;

/** The classes: weekly slots with a coach and a capacity (brief §6.4, FR-CLS-001). */
@ApiTags("classes")
@ApiErrors()
@Controller("classes")
export class ClassesController {
  @Get()
  @RequirePermission("class.view")
  @ApiResult(classListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(classListSchema, { items: await listClasses(actor) });
  }

  @Post()
  @RequirePermission("class.manage")
  @ApiResult(classSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: classInputSchema }) body: unknown) {
    return encode(classSchema, await createClass(actor, body));
  }

  @Patch(":id")
  @RequirePermission("class.manage")
  @ApiResult(classSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: classUpdateSchema }) body: unknown,
  ) {
    return encode(classSchema, await updateClass(actor, id, body));
  }
}

/** The class grid and the seats of one class session (FR-CLS-002 to FR-CLS-004). */
@ApiTags("classes")
@ApiErrors()
@Controller("class-sessions")
export class ClassSessionsController {
  @Get()
  @RequirePermission("class.view")
  @ApiOptionalQuery(...SESSION_FILTERS)
  @ApiResult(classSessionListSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(classSessionListSchema, {
      items: await listClassSessions(actor, queryOf(request, SESSION_FILTERS)),
    });
  }

  @Get(":id")
  @RequirePermission("class.view")
  @ApiResult(classSessionSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(classSessionSchema, await getClassSession(actor, id));
  }

  @Post(":id/attendees")
  @RequirePermission("class.enroll")
  @ApiResult(classSessionSchema, 201, "Created")
  async enroll(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: enrollSchema }) body: unknown,
  ) {
    return encode(classSessionSchema, await enrollCustomer(actor, id, body));
  }

  @Delete(":id/attendees/:attendeeId")
  @RequirePermission("class.enroll")
  @HttpCode(200)
  @ApiResult(classSessionSchema)
  async remove(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Param("attendeeId") attendeeId: string) {
    return encode(classSessionSchema, await removeEnrollment(actor, id, attendeeId));
  }

  /** Present consumes one session of the customer's class contract; a mark is final and repeating it changes nothing. */
  @Post(":id/attendees/:attendeeId/mark")
  @RequirePermission("class.attend")
  @HttpCode(200)
  @ApiResult(classSessionSchema)
  async mark(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Param("attendeeId") attendeeId: string,
    @Body({ schema: markAttendanceSchema }) body: unknown,
  ) {
    return encode(classSessionSchema, await markAttendance(actor, id, attendeeId, body));
  }
}
