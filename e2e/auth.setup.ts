import { test as setup, expect } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "./support/db";
import { storageStatePath } from "./support/paths";
import type { Role } from "./support/db";

// Signs in once per role through the API and saves the session, so specs start
// signed in instead of repeating the login UI (the login UI has its own spec).
for (const role of Object.keys(E2E_USERS) as Role[]) {
  setup(`sign in as ${role}`, async ({ request, baseURL }) => {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL! },
      data: { email: E2E_USERS[role].email, password: E2E_PASSWORD },
    });
    expect(response.ok()).toBe(true);
    await request.storageState({ path: storageStatePath(role) });
  });
}
