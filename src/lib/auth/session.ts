import "server-only";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { ROLES, type Role } from "@/lib/permissions";
import type { AppLocale } from "@/lib/format";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: AppLocale;
};

/** What a service needs to authorize and audit an action. */
export type Actor = Pick<CurrentUser, "id" | "role">;

const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(["ACTIVE", "DISABLED"]),
  locale: z.enum(["vi", "en"]),
});

/**
 * Resolves the signed-in user from request headers. The session and the user's
 * role and status are read from the database on every call; a disabled user gets
 * null even while their session cookie is still valid (T-017).
 */
export async function getSessionUser(headers: Headers): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) return null;

  const parsed = sessionUserSchema.safeParse(session.user);
  if (!parsed.success || parsed.data.status !== "ACTIVE") return null;

  const { id, name, email, role, locale } = parsed.data;
  return { id, name, email, role, locale };
}
