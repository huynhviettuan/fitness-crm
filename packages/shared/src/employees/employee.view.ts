import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { EMPLOYEE_STATUSES, GENDERS } from "./employee.schema.js";

// Response shapes: wire format in, Date objects out (see validation/codecs.ts).

/** How other records refer to an employee, e.g. a booking to its trainer. */
export const employeeRefSchema = z
  .object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() })
  .meta({ id: "EmployeeRef" });

export const employeeSchema = z
  .object({
    id: z.uuid(),
    employeeCode: z.string(),
    branch: branchRefSchema,
    fullName: z.string(),
    /** A calendar date at UTC midnight. */
    birthDate: instant.nullable(),
    gender: z.enum(GENDERS).nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    department: chosenOptionSchema.nullable(),
    team: z.string().nullable(),
    title: chosenOptionSchema.nullable(),
    /** The direct manager (D-046). */
    manager: employeeRefSchema.nullable(),
    status: z.enum(EMPLOYEE_STATUSES),
    isTrainer: z.boolean(),
    /** The linked login (brief §8.4), if any. */
    user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  })
  .meta({ id: "Employee" });

export const employeePageSchema = pageOf(employeeSchema).meta({ id: "EmployeePage" });

/** A login that can be linked to an employee, and the employee it is linked to. */
export const employeeLoginSchema = z
  .object({ id: z.uuid(), name: z.string(), email: z.string(), linkedEmployeeId: z.uuid().nullable() })
  .meta({ id: "EmployeeLogin" });

export const employeeLoginListSchema = listOf(employeeLoginSchema).meta({ id: "EmployeeLoginList" });

export const shiftViewSchema = z.object({ weekday: z.int(), start: z.string(), end: z.string() }).meta({ id: "Shift" });

export const dayOffSchema = z
  .object({
    id: z.uuid(),
    /** A calendar date at UTC midnight. */
    date: instant,
    note: z.string().nullable(),
  })
  .meta({ id: "DayOff" });

/** An employee's working schedule: the weekly shifts and the days off from today on. */
export const workScheduleSchema = z
  .object({ shifts: z.array(shiftViewSchema), daysOff: z.array(dayOffSchema) })
  .meta({ id: "WorkSchedule" });

/** One trainer's day on the PT calendar: when they can be booked (D-030). */
export const trainerDaySchema = z
  .object({
    trainer: employeeRefSchema,
    /** The branch the trainer works in, for the calendar's branch filter. */
    branchId: z.uuid(),
    /** On-duty hours of the day, HH:mm to HH:mm (24:00 is midnight); empty on a day off. Shown, never a limit (D-058). */
    workingHours: z.array(z.object({ start: z.string(), end: z.string() })),
    dayOff: z.boolean(),
  })
  .meta({ id: "TrainerDay" });

export const trainerDayListSchema = listOf(trainerDaySchema).meta({ id: "TrainerDayList" });

export type Employee = z.output<typeof employeeSchema>;
export type EmployeePage = z.output<typeof employeePageSchema>;
export type EmployeeRef = z.output<typeof employeeRefSchema>;
export type EmployeeLogin = z.output<typeof employeeLoginSchema>;
export type DayOff = z.output<typeof dayOffSchema>;
export type WorkSchedule = z.output<typeof workScheduleSchema>;
export type TrainerDay = z.output<typeof trainerDaySchema>;
