import { z } from "zod";
import { PERMISSION_KEYS } from "../permissions/index.js";
import { hasNoControlCharacters, timeOfDay } from "../validation/index.js";

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** ISO weekdays, as access windows store them: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
const name = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(100, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });
const email = z.string().trim().toLowerCase().pipe(z.email({ error: "invalidEmail" }));
const password = z.string().min(10, { error: "passwordTooShort" }).max(128, { error: "tooLong" });
const roleId = z.uuid({ error: "required" });
const userId = z.uuid({ error: "required" });

/** D-014: a user works in every branch or in the granted ones (at least one). */
const branchAccess = {
  allBranches: z.boolean({ error: "invalidChoice" }).prefault(false),
  branchIds: z
    .array(z.uuid({ error: "invalidChoice" }))
    .prefault([])
    .transform((ids) => [...new Set(ids)]),
};
const needsABranch = (data: { allBranches: boolean; branchIds: string[] }) => data.allBranches || data.branchIds.length > 0;
const branchRequired = { path: ["branchIds"], error: "required" };

export const createUserSchema = z
  .object({ name, email, roleId, password, ...branchAccess })
  .refine(needsABranch, branchRequired);
export const changeRoleSchema = z.object({ userId, roleId });
export const setUserStatusSchema = z.object({ userId, status: z.enum(USER_STATUSES) });
export const resetPasswordSchema = z.object({ userId, password });
export const setLocaleSchema = z.object({ locale: z.enum(LOCALES) });
export const setUserBranchesSchema = z.object({ userId, ...branchAccess }).refine(needsABranch, branchRequired);
/** The body of `PUT /users/:id/branches`; the path names the user. */
export const userBranchesBodySchema = z.object(branchAccess).refine(needsABranch, branchRequired);

/** FR-PLT-003: single permissions switched on or off for one user; replaces the list. */
export const setOverridesSchema = z.object({
  userId,
  overrides: z
    .array(z.object({ permission: z.enum(PERMISSION_KEYS, { error: "invalidChoice" }), granted: z.boolean() }))
    .refine((list) => new Set(list.map((o) => o.permission)).size === list.length, { error: "duplicate" }),
});

/** An allowed sign-in window in the gym timezone (D-017). */
export const accessWindowSchema = z
  .object({
    weekdays: z
      .array(z.union(WEEKDAYS.map((day) => z.literal(day)), { error: "invalidChoice" }))
      .min(1, { error: "required" })
      .transform((days) => [...new Set(days)].sort()),
    startTime: timeOfDay,
    endTime: timeOfDay,
  })
  .refine((window) => window.endTime > window.startTime, { path: ["endTime"], error: "endTimeNotAfterStart" });

/** Replaces the user's windows; an empty list means any time. */
export const setAccessWindowsSchema = z.object({ userId, windows: z.array(accessWindowSchema).max(14, { error: "tooLong" }) });

export const loginHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateUserInput = z.input<typeof createUserSchema>;
export type AccessWindowInput = z.input<typeof accessWindowSchema>;
export type AccessWindow = z.output<typeof accessWindowSchema>;
