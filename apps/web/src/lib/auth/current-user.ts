import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Me } from "@flow/shared/users";
import { getMe } from "@/lib/api/users";

/** The signed-in user as the API sees them, with their permissions (docs/07 `GET /me`). */
export type CurrentUser = Me;

/** The signed-in user for this request, read once per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => getMe());

/** For pages and layouts: sends signed-out users to the login page. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
