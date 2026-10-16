// OWASP A01 (access control) and A10 (input errors) for the weekly workout dashboard and the customer progress of M7.5
// (brief §7.5, §9; FR-WKO-005). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { bookingSetup } from "../support/data";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const DASHBOARD: Role[] = ["ADMIN", "FITNESS_MANAGER"];
const PROGRESS: Role[] = ["ADMIN", "FITNESS_MANAGER", "PT"];

test.describe("A01 who sees the dashboard", () => {
  for (const role of ROLES) {
    test(`${role} asking for the dashboard gets ${DASHBOARD.includes(role) ? 200 : 403}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const status = DASHBOARD.includes(role) ? 200 : 403;
      expect((await api.get("/api/v1/reports/workouts")).status()).toBe(status);
      expect((await api.get("/api/v1/reports/workouts/sets?kind=nonNormal")).status()).toBe(status);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/reports/workouts")).status()).toBe(401);
    expect((await anonymous.get("/api/v1/reports/workouts/sets?kind=flag")).status()).toBe(401);
    expect((await anonymous.get(`/api/v1/workout/progress/${randomUUID()}`)).status()).toBe(401);
  });
});

test.describe("A10 the inputs", () => {
  test("bad queries are 400 and the dashboard of another week is just empty", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    // The manager works in some branches only, so a branch they do not have is refused (Admin has them all).
    const manager = await apiAs("FITNESS_MANAGER");
    expect((await manager.get(`/api/v1/reports/workouts?branchId=${randomUUID()}`)).status()).toBe(400);
    for (const query of ["week=99%2F99%2F2026", "week=nope", "branchId=nope"]) {
      const response = await admin.get(`/api/v1/reports/workouts?${query}`);
      expect(response.status(), query).toBe(400);
    }
    for (const query of [
      "",
      "kind=other",
      "kind=flag",
      "kind=flag&optionId=nope",
      "kind=nonNormal&pageSize=101",
      "kind=nonNormal&page=0",
    ]) {
      expect((await admin.get(`/api/v1/reports/workouts/sets?${query}`)).status(), query).toBe(400);
    }
    const empty = await admin.get("/api/v1/reports/workouts?week=01%2F01%2F2040");
    expect(empty.status()).toBe(200);
    expect(await empty.json()).toMatchObject({ totals: { sets: 0, sessions: 0 }, nonNormalCustomers: 0 });
  });
});

test.describe("A01 the customer's progress", () => {
  for (const role of ROLES) {
    test(`${role} asking for a customer's progress gets ${PROGRESS.includes(role) ? "200 or 404" : 403}`, async ({
      apiAs,
      testTag,
    }) => {
      const { customer } = await bookingSetup(apiAs, testTag);
      const response = await (await apiAs(role)).get(`/api/v1/workout/progress/${customer.id}`);
      if (!PROGRESS.includes(role)) expect(response.status()).toBe(403);
      // A PT sees a customer only of their own, so this one is not found for them.
      else expect(response.status()).toBe(role === "PT" ? 404 : 200);
    });
  }

  test("an unknown or malformed customer is not found, never a server error", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    expect((await admin.get(`/api/v1/workout/progress/${randomUUID()}`)).status()).toBe(404);
    expect((await admin.get("/api/v1/workout/progress/not-a-uuid")).status()).toBe(404);
  });
});
