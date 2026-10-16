// OWASP A01 (access control) and A02 (nothing secret in the answer) for the System status page (A-321). Route-level 401s
// are covered by the route inventory in access-control.spec.ts.
import { expect, test } from "../fixtures";

test.describe("A01 the System status is Admin's (A-321)", () => {
  test("Admin reads it; every other default role is refused", async ({ apiAs }) => {
    expect((await (await apiAs("ADMIN")).get("/api/v1/system/status")).status()).toBe(200);
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "ACCOUNTANT", "PT", "CONSULTING"] as const) {
      expect((await (await apiAs(role)).get("/api/v1/system/status")).status(), role).toBe(403);
    }
  });
});

test.describe("A02 what it says about the server", () => {
  test("settings are only on or off, and no key, address or connection string is in it", async ({ apiAs }) => {
    const body = await (await (await apiAs("ADMIN")).get("/api/v1/system/status")).json();
    expect(Object.keys(body.settings).sort()).toEqual(
      ["backups", "emailDelivery", "errorMonitoring", "fileStorage", "jobsInApi"].sort(),
    );
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    for (const secret of [process.env.FIELD_ENCRYPTION_KEY, process.env.BETTER_AUTH_SECRET]) {
      if (secret) expect(text).not.toContain(secret);
    }
  });
});
