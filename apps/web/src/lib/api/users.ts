import "server-only";
import { meSchema, userListSchema, userSchema } from "@flow/shared/users";
import { ApiError } from "./errors";
import { api, done, read } from "./client";

/** The signed-in user and what they may do, or null when signed out. */
export async function getMe() {
  try {
    return await read(meSchema, (await api()).GET("/api/v1/me"));
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") return null;
    throw error;
  }
}

/** Any signed-in user may choose their own UI language. */
export async function setOwnLocale(locale: string) {
  return done((await api()).PATCH("/api/v1/me/locale", { body: { locale } as { locale: "vi" | "en" } }));
}

// The admin user screens pass form input through as is; the API validates it.

export async function listUsers() {
  const { items } = await read(userListSchema, (await api()).GET("/api/v1/users"));
  return items;
}

export async function createUser(input: unknown) {
  return read(userSchema, (await api()).POST("/api/v1/users", { body: input as never }));
}

export async function changeUserRole(userId: string, input: unknown) {
  return read(userSchema, (await api()).PUT("/api/v1/users/{id}/role", { params: { path: { id: userId } }, body: input as never }));
}

export async function setUserStatus(userId: string, input: unknown) {
  return read(
    userSchema,
    (await api()).PUT("/api/v1/users/{id}/status", { params: { path: { id: userId } }, body: input as never }),
  );
}

export async function resetUserPassword(userId: string, input: unknown) {
  return done((await api()).PUT("/api/v1/users/{id}/password", { params: { path: { id: userId } }, body: input as never }));
}
