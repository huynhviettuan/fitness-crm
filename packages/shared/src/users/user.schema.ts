import { z } from "zod";
import { ROLES } from "../permissions/index.js";
import { hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
const name = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(100, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });
const email = z.string().trim().toLowerCase().pipe(z.email({ error: "invalidEmail" }));
const password = z.string().min(10, { error: "passwordTooShort" }).max(128, { error: "tooLong" });
const role = z.enum(ROLES, { error: "required" });
const userId = z.uuid({ error: "required" });

export const createUserSchema = z.object({ name, email, role, password });
export const changeRoleSchema = z.object({ userId, role });
export const setUserStatusSchema = z.object({ userId, status: z.enum(["ACTIVE", "DISABLED"]) });
export const resetPasswordSchema = z.object({ userId, password });
export const setLocaleSchema = z.object({ locale: z.enum(["vi", "en"]) });

export type CreateUserInput = z.input<typeof createUserSchema>;
