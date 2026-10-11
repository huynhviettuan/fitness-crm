import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  dayOffInputSchema,
  dayOffSchema,
  employeeInputSchema,
  employeeLoginListSchema,
  employeePageSchema,
  employeeSchema,
  shiftsInputSchema,
  workScheduleSchema,
} from "@flow/shared/employees";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  addDayOff,
  createEmployee,
  getEmployee,
  getWorkSchedule,
  listEmployeeLogins,
  listEmployees,
  removeDayOff,
  replaceShifts,
  updateEmployee,
} from "./employee.service.js";

const FILTERS = ["q", "status", "departmentId", "trainersOnly", "page", "pageSize"] as const;

/** Employees and their working schedules (brief §8.4). */
@ApiTags("employees")
@ApiErrors()
@Controller("employees")
export class EmployeesController {
  @Get()
  @RequirePermission("employee.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(employeePageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(employeePageSchema, await listEmployees(actor, queryOf(request, FILTERS)));
  }

  @Post()
  @RequirePermission("employee.manage")
  @ApiResult(employeeSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: employeeInputSchema }) body: unknown) {
    return encode(employeeSchema, await createEmployee(actor, body));
  }

  /** Logins that can be linked to an employee, and the employee each belongs to. */
  @Get("logins")
  @RequirePermission("employee.manage")
  @ApiResult(employeeLoginListSchema)
  async logins(@CurrentActor() actor: CurrentUser) {
    return encode(employeeLoginListSchema, { items: await listEmployeeLogins(actor) });
  }

  @Get(":id")
  @RequirePermission("employee.view")
  @ApiResult(employeeSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(employeeSchema, await getEmployee(actor, id));
  }

  /** All fields are sent; the employee code never changes (T-019). */
  @Patch(":id")
  @RequirePermission("employee.manage")
  @ApiResult(employeeSchema)
  async update(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: employeeInputSchema }) body: unknown) {
    return encode(employeeSchema, await updateEmployee(actor, id, body));
  }

  /** Weekly shifts and the days off from today on. */
  @Get(":id/schedule")
  @RequirePermission("employee.view")
  @ApiResult(workScheduleSchema)
  async schedule(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(workScheduleSchema, await getWorkSchedule(actor, id));
  }

  /** Replaces the weekly shifts (D-030); bookings already made are not touched. */
  @Put(":id/shifts")
  @RequirePermission("employee.manage")
  @ApiResult(workScheduleSchema)
  async shifts(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: shiftsInputSchema }) body: unknown) {
    return encode(workScheduleSchema, await replaceShifts(actor, id, body));
  }

  @Post(":id/days-off")
  @RequirePermission("employee.manage")
  @ApiResult(dayOffSchema, 201, "Created")
  async addDayOff(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Body({ schema: dayOffInputSchema }) body: unknown) {
    return encode(dayOffSchema, await addDayOff(actor, id, body));
  }

  @Delete(":id/days-off/:dayOffId")
  @RequirePermission("employee.manage")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "The employee works that day again" })
  async removeDayOff(@CurrentActor() actor: CurrentUser, @Param("id") id: string, @Param("dayOffId") dayOffId: string): Promise<void> {
    await removeDayOff(actor, id, dayOffId);
  }
}
