import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { DATA_SCOPES, DATA_SCOPE_RESOURCES, MASKABLE_FIELDS, PERMISSION_KEYS } from "../permissions/index.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { LOCALES, USER_STATUSES, WEEKDAYS } from "./user.schema.js";

/** How users name their role. */
export const roleRefSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: "RoleRef" });

export const userSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: roleRefSchema,
    status: z.enum(USER_STATUSES),
    locale: z.enum(LOCALES),
    allBranches: z.boolean(),
    branches: z.array(branchRefSchema),
    createdAt: instant,
  })
  .meta({ id: "User" });

export const userListSchema = listOf(userSchema).meta({ id: "UserList" });

/** A user with their individual permissions and access hours (FR-PLT-001, FR-PLT-003). */
export const userDetailSchema = userSchema
  .extend({
    overrides: z.array(z.object({ permission: z.enum(PERMISSION_KEYS), granted: z.boolean() })),
    accessWindows: z.array(
      z.object({ weekdays: z.array(z.union(WEEKDAYS.map((day) => z.literal(day)))), startTime: z.string(), endTime: z.string() }),
    ),
  })
  .meta({ id: "UserDetail" });

/** One sign-in attempt (D-017). */
export const loginEventSchema = z
  .object({
    id: z.uuid(),
    at: instant,
    success: z.boolean(),
    reason: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .meta({ id: "LoginEvent" });

export const loginEventPageSchema = pageOf(loginEventSchema).meta({ id: "LoginEventPage" });

/** The signed-in user and what they may do (docs/07 `GET /me`). */
export const meSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: roleRefSchema,
    locale: z.enum(LOCALES),
    /** The employee this login belongs to (brief §8.4), if any. */
    employeeId: z.uuid().nullable(),
    /** Effective permissions: the role's, with this user's overrides applied. */
    permissions: z.array(z.enum(PERMISSION_KEYS)),
    /** ALL or OWN per resource (D-017), e.g. a PT books only for themselves. */
    dataScopes: z.record(z.enum(DATA_SCOPE_RESOURCES), z.enum(DATA_SCOPES)),
    allBranches: z.boolean(),
    /** The active branches the user works in, to choose from when creating records. */
    branches: z.array(branchRefSchema),
    maskedFields: z.array(z.enum(MASKABLE_FIELDS)),
  })
  .meta({ id: "Me" });

export type User = z.output<typeof userSchema>;
export type UserDetail = z.output<typeof userDetailSchema>;
export type LoginEvent = z.output<typeof loginEventSchema>;
export type Me = z.output<typeof meSchema>;
