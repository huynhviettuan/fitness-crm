// OWASP A01:2025 for M1 slice 2: every endpoint checks its permission (T-046), and
// branch access hides other branches' records (D-014).
import { expect, test } from "../fixtures";
import { createUserViaApi, roleIdOf } from "../support/admin";
import { createCustomerViaApi } from "../support/data";
import { discoverApiRoutes } from "../support/routes";

const SCOPES_ALL = {
  leads: "ALL",
  customers: "ALL",
  contracts: "ALL",
  schedule: "ALL",
  vouchers: "ALL",
  staff: "ALL",
  tasks: "ALL",
};

test.describe("A01 permissions on every endpoint (T-046)", () => {
  test("a user whose role grants nothing is refused by every endpoint that declares a permission", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const role = await admin.post("/api/v1/roles", {
      data: { name: `Không quyền ${testTag}`, permissions: [], dataScopes: SCOPES_ALL, fieldMasks: [] },
    });
    expect(role.status()).toBe(201);
    const user = await createUserViaApi(admin, testTag, { roleId: (await role.json()).id, label: "Nobody" });
    const api = await apiSignedIn(user.email, user.password);

    for (const route of discoverApiRoutes()) {
      for (const method of route.methods) {
        const response = await api.fetch(route.path, { method, data: method === "GET" ? undefined : {} });
        // Endpoints for any signed-in user (own profile, option lists, parameters) answer;
        // with the random ids of the walk, that may be a 404.
        const expected = route.permissions[method] === "authenticated" ? [200, 204, 400, 404] : [403];
        expect(expected, `${method} ${route.template} answered ${response.status()}`).toContain(response.status());
      }
    }
  });

  test("a Fitness Manager cannot manage users, roles, branches, or configuration, nor see the trash or history (09_RBAC.md)", async ({
    apiAs,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    for (const path of [
      "/api/v1/users",
      "/api/v1/roles",
      "/api/v1/branches",
      "/api/v1/option-lists/paymentMethods/other-notes",
      "/api/v1/trash",
      "/api/v1/audit-events",
      "/api/v1/approval-rules",
    ]) {
      expect((await manager.get(path)).status(), path).toBe(403);
    }
    // Configuration is admin's (09_RBAC.md); reading it is open to forms.
    expect((await manager.get("/api/v1/option-lists/paymentMethods/options")).status()).toBe(200);
    expect(
      (
        await manager.post("/api/v1/option-lists/paymentMethods/options", { data: { labelVi: "x", labelEn: "x" } })
      ).status(),
    ).toBe(403);
    expect((await manager.put("/api/v1/parameters", { data: {} })).status()).toBe(403);
  });
});

test.describe("A01 branch access (D-014)", () => {
  test("a user of another branch cannot find or open a customer", async ({ apiAs, apiSignedIn, testTag }) => {
    const admin = await apiAs("ADMIN");
    const branch = await admin.post("/api/v1/branches", { data: { name: `CN ${testTag}`, active: false } });
    expect(branch.status()).toBe(201);
    const elsewhere = await createUserViaApi(admin, testTag, {
      roleId: await roleIdOf(admin, { code: "RECEPTIONIST" }),
      branchIds: [(await branch.json()).id],
      label: "Elsewhere",
    });
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    const api = await apiSignedIn(elsewhere.email, elsewhere.password);
    expect((await api.get(`/api/v1/customers/${customer.id}`)).status()).toBe(404);
    expect((await (await api.get(`/api/v1/customers?search=${testTag}`)).json()).total).toBe(0);
  });
});
