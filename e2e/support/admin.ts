import type { APIRequestContext } from "@playwright/test";
import { E2E_BRANCH_ID, type Role } from "./db";

export const ADMIN_MADE_PASSWORD = "E2e-made-user-1";

/** A role's id, by its default code or by name (admin API). */
export async function roleIdOf(admin: APIRequestContext, which: { code?: Role; name?: string }): Promise<string> {
  const { items } = (await (await admin.get("/api/v1/roles")).json()) as { items: { id: string; code: string | null; name: string }[] };
  const role = items.find((r) => (which.code ? r.code === which.code : r.name === which.name));
  if (!role) throw new Error(`No role ${JSON.stringify(which)}`);
  return role.id;
}

/** An account made through the admin API; its name carries the tag, so teardown removes it. */
export async function createUserViaApi(
  admin: APIRequestContext,
  tag: string,
  options: { roleId: string; branchIds?: string[]; label?: string },
): Promise<{ id: string; email: string; password: string }> {
  const email = `${(options.label ?? "user").toLowerCase().replace(/\W+/g, "-")}-${tag.toLowerCase()}@fitness-crm.test`;
  const response = await admin.post("/api/v1/users", {
    data: {
      name: `${options.label ?? "User"} ${tag}`,
      email,
      roleId: options.roleId,
      branchIds: options.branchIds ?? [E2E_BRANCH_ID],
      password: ADMIN_MADE_PASSWORD,
    },
  });
  if (response.status() !== 201) throw new Error(`User setup failed: ${response.status()} ${await response.text()}`);
  return { id: (await response.json()).id, email, password: ADMIN_MADE_PASSWORD };
}

/** An ISO weekday (1 = Monday … 7 = Sunday) that is not today in the gym timezone. */
export function anotherWeekday(): number {
  const name = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const today = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name) + 1;
  return (today % 7) + 1;
}
