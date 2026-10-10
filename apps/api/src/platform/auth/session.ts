import { prisma } from "../db/prisma.js";
import { env } from "../env.js";
import { isWithinAccessWindows } from "./access-hours.js";
import { loadCurrentUser, type CurrentUser } from "./actor.js";
import { auth } from "./auth.js";

export type { Actor, CurrentUser } from "./actor.js";

/**
 * Resolves the signed-in user from request headers. The session, the user's status,
 * role, overrides, branches, and access hours are read from the database on every call:
 * a disabled user, or one outside their allowed hours, gets null even while their
 * session cookie is still valid (T-017, D-017).
 */
export async function getSessionUser(headers: Headers, now: Date = new Date()): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) return null;

  const user = await loadCurrentUser(prisma, session.user.id);
  if (!user || user.status !== "ACTIVE") return null;
  if (!isWithinAccessWindows(user.accessWindows, now, env.GYM_TIMEZONE)) return null;
  return user;
}
