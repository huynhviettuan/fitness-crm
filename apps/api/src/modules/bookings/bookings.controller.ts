import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  bookingInputSchema,
  bookingListSchema,
  bookingPageSchema,
  bookingSchema,
  completeDayResultSchema,
  completeDaySchema,
  rescheduleSchema,
  sessionCompletionSchema,
} from "@flow/shared/bookings";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { checkIn, completeSession, completeSessions } from "../sessions/session.service.js";
import { trainersOfDay } from "../employees/employee.service.js";
import { trainerDayListSchema } from "@flow/shared/employees";
import { deleteSchema } from "@flow/shared/trash";
import {
  cancelBooking,
  createBooking,
  deleteBooking,
  getBooking,
  listBookings,
  listDayBookings,
  markNoShow,
  rescheduleBooking,
} from "./booking.service.js";

const FILTERS = [
  "from",
  "to",
  "status",
  "checkedIn",
  "trainerId",
  "customerId",
  "contractId",
  "order",
  "page",
  "pageSize",
] as const;

@ApiTags("bookings")
@ApiErrors()
@Controller("bookings")
export class BookingsController {
  @Get()
  @RequirePermission("booking.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(bookingPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(bookingPageSchema, await listBookings(actor, queryOf(request, FILTERS)));
  }

  /**
   * No Idempotency-Key (T-015 covers money and contracts): a repeated create for the
   * same trainer and time is refused by the overlap constraint (T-014).
   */
  @Post()
  @RequirePermission("booking.manage")
  @ApiResult(bookingSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: bookingInputSchema }) body: unknown) {
    return encode(bookingSchema, await createBooking(actor, body));
  }

  @Get(":id")
  @RequirePermission("booking.view")
  @ApiResult(bookingSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(bookingSchema, await getBooking(actor, id));
  }

  /** Reschedule (A-006: BOOKED only): trainer, date, start and end time. */
  @Patch(":id")
  @RequirePermission("booking.manage")
  @ApiResult(bookingSchema)
  async reschedule(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: rescheduleSchema }) body: unknown,
  ) {
    return encode(bookingSchema, await rescheduleBooking(actor, id, body));
  }

  /** Bulk "Đã tập" for a day: one result per session (M5.3). */
  @Post("complete-day")
  @RequirePermission("session.complete")
  @HttpCode(200)
  @ApiResult(completeDayResultSchema)
  async completeDay(@CurrentActor() actor: CurrentUser, @Body({ schema: completeDaySchema }) body: unknown) {
    return encode(completeDayResultSchema, await completeSessions(actor, body));
  }

  /** Xóa: a Booked session booked by mistake goes to the trash with a reason (M5.3). */
  @Delete(":id")
  @RequirePermission("booking.delete")
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deleteSchema }) body: unknown,
  ) {
    await deleteBooking(actor, id, body);
  }

  @Post(":id/cancel")
  @RequirePermission("booking.manage")
  @HttpCode(200)
  @ApiResult(bookingSchema)
  async cancel(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(bookingSchema, await cancelBooking(actor, id));
  }

  @Post(":id/no-show")
  @RequirePermission("booking.manage")
  @HttpCode(200)
  @ApiResult(bookingSchema)
  async noShow(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(bookingSchema, await markNoShow(actor, id));
  }

  @Post(":id/check-in")
  @RequirePermission("session.checkIn")
  @HttpCode(200)
  @ApiResult(bookingSchema)
  async checkIn(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(bookingSchema, await checkIn(actor, id));
  }

  /**
   * Idempotent: repeating it returns the same completed state and consumes nothing more
   * (BR-007). The response carries the contract with its new remaining sessions.
   */
  @Post(":id/complete")
  @RequirePermission("session.complete")
  @HttpCode(200)
  @ApiResult(sessionCompletionSchema)
  async complete(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(sessionCompletionSchema, await completeSession(actor, id));
  }
}

/** The PT calendar: one gym day of bookings, optionally for one trainer (docs/07 `/schedule`). */
@ApiTags("bookings")
@ApiErrors()
@Controller("schedule")
export class ScheduleController {
  @Get()
  @RequirePermission("booking.view")
  @ApiOptionalQuery("date", "days", "trainerId", "customerId", "branchId")
  @ApiResult(bookingListSchema)
  async day(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(bookingListSchema, {
      items: await listDayBookings(actor, queryOf(request, ["date", "days", "trainerId", "customerId", "branchId"])),
    });
  }

  /**
   * The calendar's trainers for one day and when each can be booked (D-030): active
   * trainers of the user's branches, or only themselves with "own" schedule scope.
   */
  @Get("trainers")
  @RequirePermission("booking.view")
  @ApiOptionalQuery("date")
  @ApiResult(trainerDayListSchema)
  async trainers(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(trainerDayListSchema, { items: await trainersOfDay(actor, queryOf(request, ["date"])) });
  }
}
