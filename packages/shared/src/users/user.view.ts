import { z } from "zod";
import { PERMISSION_KEYS, ROLES } from "../permissions/index.js";
import { instant, listOf } from "../validation/index.js";
import { LOCALES, USER_STATUSES } from "./user.schema.js";

export const userSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    status: z.enum(USER_STATUSES),
    locale: z.enum(LOCALES),
    createdAt: instant,
  })
  .meta({ id: "User" });

export const userListSchema = listOf(userSchema).meta({ id: "UserList" });

/** The signed-in user and what they may do (docs/07 `GET /me`). */
export const meSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    locale: z.enum(LOCALES),
    /** The trainer record this login acts as (A-010), if any. */
    trainerId: z.uuid().nullable(),
    permissions: z.array(z.enum(PERMISSION_KEYS)),
  })
  .meta({ id: "Me" });

export type User = z.output<typeof userSchema>;
export type Me = z.output<typeof meSchema>;
