import "server-only";
import { loginEventPageSchema, meSchema, userDetailSchema, userListSchema, userSchema } from "@flow/shared/users";
import { ApiError } from "./errors";
import { api, done, query, read } from "./client";

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

/** With individual permissions and access hours (FR-PLT-001). */
export async function getUser(id: string) {
  return read(userDetailSchema, (await api()).GET("/api/v1/users/{id}", { params: { path: { id } } }));
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

export async function setUserBranches(userId: string, input: unknown) {
  return read(
    userSchema,
    (await api()).PUT("/api/v1/users/{id}/branches", { params: { path: { id: userId } }, body: input as never }),
  );
}

export async function setUserOverrides(userId: string, input: unknown) {
  return read(
    userDetailSchema,
    (await api()).PUT("/api/v1/users/{id}/overrides", { params: { path: { id: userId } }, body: input as never }),
  );
}

export async function setUserAccessHours(userId: string, input: unknown) {
  return read(
    userDetailSchema,
    (await api()).PUT("/api/v1/users/{id}/access-hours", { params: { path: { id: userId } }, body: input as never }),
  );
}

export async function listLoginHistory(userId: string, params: { page?: number }) {
  return read(
    loginEventPageSchema,
    (await api()).GET("/api/v1/users/{id}/logins", { params: { path: { id: userId }, query: query(params) } }),
  );
}

export async function resetUserPassword(userId: string, input: unknown) {
  return done((await api()).PUT("/api/v1/users/{id}/password", { params: { path: { id: userId } }, body: input as never }));
}
