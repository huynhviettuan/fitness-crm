import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { employeeRefSchema } from "../employees/employee.view.js";
import { instant, listOf } from "../validation/index.js";
import { CLASS_ATTENDANCE_STATUSES, CLASS_SESSION_STATUSES } from "./class.domain.js";

export const classSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    branch: branchRefSchema,
    coach: employeeRefSchema,
    capacity: z.int(),
    weekdays: z.array(z.int()),
    startTime: z.string(),
    endTime: z.string(),
    active: z.boolean(),
  })
  .meta({ id: "GymClass" });

export const classListSchema = listOf(classSchema).meta({ id: "GymClassList" });

/** One seat of a class session. */
export const classAttendeeSchema = z
  .object({
    id: z.uuid(),
    customer: customerRefSchema,
    contract: z.object({
      id: z.uuid(),
      contractCode: z.string(),
      packageName: z.string(),
      remainingSessions: z.int(),
    }),
    status: z.enum(CLASS_ATTENDANCE_STATUSES),
    /** Present: this attendance used one session of the contract. */
    consumes: z.boolean(),
    enrolledAt: instant,
    markedAt: instant.nullable(),
    markedBy: z.string().nullable(),
  })
  .meta({ id: "ClassAttendee" });

export const classSessionSchema = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    name: z.string(),
    branch: branchRefSchema,
    coach: employeeRefSchema,
    capacity: z.int(),
    startsAt: instant,
    endsAt: instant,
    status: z.enum(CLASS_SESSION_STATUSES),
    /** Enrolled and present customers: the seats taken. */
    seatsTaken: z.int(),
    present: z.int(),
    /** At least one customer was present: it counts as a teaching session for the coach (A-164). */
    taught: z.boolean(),
    /** Only on the detail of one session. */
    attendees: z.array(classAttendeeSchema).optional(),
  })
  .meta({ id: "ClassSession" });

export const classSessionListSchema = listOf(classSessionSchema).meta({ id: "ClassSessionList" });

export type GymClass = z.output<typeof classSchema>;
export type ClassAttendee = z.output<typeof classAttendeeSchema>;
export type ClassSession = z.output<typeof classSessionSchema>;
