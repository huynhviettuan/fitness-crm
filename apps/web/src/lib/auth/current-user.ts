import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors/app-error";
import { getSessionUser, type CurrentUser } from "@/lib/auth/session";

/** The signed-in user for this request, read once per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return getSessionUser(await headers());
});

/** For pages and layouts: sends signed-out users to the login page. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For Server Actions: a signed-out user gets UNAUTHENTICATED. */
export async function requireActionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}
