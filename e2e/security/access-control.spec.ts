// OWASP A01:2025 Broken Access Control, A04:2025 Cryptographic Failures (secrets in responses).
import { expect, test } from "../fixtures";
import { uniquePhone } from "../support/data";
import { discoverApiRoutes } from "../support/routes";
import { E2E_BRANCH_ID, type Role } from "../support/db";

const routes = discoverApiRoutes();

test.describe("A01 every API route requires a session", () => {
  test("the route inventory found the API", () => {
    expect(routes.map((r) => r.template)).toEqual(
      expect.arrayContaining(["/api/v1/customers", "/api/v1/customers/{id}", "/api/v1/me"]),
    );
  });

  test("only the health checks answer without a session, and tell nothing of the gym (M9.4, A-311, A-315)", async ({
    apiAs,
  }) => {
    const open = routes.flatMap((route) =>
      route.methods
        .filter((method) => route.permissions[method] === "public")
        .map((method) => `${method} ${route.template}`),
    );
    expect(open).toEqual(["GET /api/v1/health", "GET /api/v1/health/ready"]);
    const anonymous = await apiAs(null);
    for (const [path, fields] of [
      ["/api/v1/health", ["release", "status", "time"]],
      ["/api/v1/health/ready", ["database", "release", "status", "time"]],
    ] as const) {
      const response = await anonymous.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["cache-control"], path).toBe("no-store");
      expect(Object.keys(await response.json()).sort(), path).toEqual(fields);
    }
  });

  for (const route of routes) {
    for (const method of route.methods.filter((method) => route.permissions[method] !== "public")) {
      test(`${method} ${route.template} without a session is 401`, async ({ apiAs }) => {
        const api = await apiAs(null);
        const response = await api.fetch(route.path, { method, data: method === "GET" ? undefined : {} });

        expect(response.status()).toBe(401);
        expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      });
    }
  }
});

test.describe("A01 roles are enforced on the server (docs/09)", () => {
  const createExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["RECEPTIONIST", 201],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];

  for (const [role, status] of createExpectations) {
    test(`${role} creating a customer gets ${status}`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/customers", {
        data: { fullName: `RBAC ${testTag}`, phone: uniquePhone() },
      });

      expect(response.status()).toBe(status);
    });
  }

  for (const role of ["PT", "ACCOUNTANT"] as const) {
    test(`${role} cannot update a customer`, async ({ apiAs, testTag }) => {
      const reception = await apiAs("RECEPTIONIST");
      const customer = await (
        await reception.post("/api/v1/customers", { data: { fullName: `Target ${testTag}`, phone: uniquePhone() } })
      ).json();

      const api = await apiAs(role);
      const response = await api.patch(`/api/v1/customers/${customer.id}`, { data: { fullName: "Changed" } });

      expect(response.status()).toBe(403);
      expect((await (await reception.get(`/api/v1/customers/${customer.id}`)).json()).fullName).toBe(
        `Target ${testTag}`,
      );
    });
  }

  test("a trainer cannot open a customer by id, even with the real id (OQ-006 interim)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await (
      await reception.post("/api/v1/customers", { data: { fullName: `Hidden ${testTag}`, phone: uniquePhone() } })
    ).json();

    const trainer = await apiAs("PT");

    expect((await trainer.get(`/api/v1/customers/${customer.id}`)).status()).toBe(404);
    expect((await (await trainer.get(`/api/v1/customers?search=${testTag}`)).json()).total).toBe(0);
  });

  test("fields the client must not control are ignored (mass assignment)", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST");
    const forged = {
      fullName: `Forged ${testTag}`,
      phone: uniquePhone(),
      id: "00000000-0000-4000-8000-000000000000",
      customerCode: "KH999999",
      status: "INACTIVE",
      createdAt: "2000-01-01T00:00:00Z",
    };

    const created = await (await api.post("/api/v1/customers", { data: forged })).json();
    expect(created).toMatchObject({ status: "ACTIVE" });
    expect(created.id).not.toBe(forged.id);
    expect(created.customerCode).not.toBe(forged.customerCode);
    expect(new Date(created.createdAt).getFullYear()).toBeGreaterThan(2000);

    const patched = await (
      await api.patch(`/api/v1/customers/${created.id}`, { data: { customerCode: "KH999998" } })
    ).json();
    expect(patched.customerCode).toBe(created.customerCode);
  });

  test("Better Auth endpoints the app does not offer are disabled", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/update-user",
      "/api/auth/delete-user",
      "/api/auth/change-email",
    ]) {
      const response = await api.post(path, {
        data: { email: "x@y.test", password: "Whatever-123", name: "X", role: "ADMIN" },
      });
      expect(response.status(), path).toBe(404);
    }
  });
});

test.describe("A04 responses never expose secrets", () => {
  const FORBIDDEN_KEYS = /"(password|passwordHash|hash|token|secret)"\s*:/i;

  test("the current-user and customer APIs return only safe fields", async ({ apiAs, testTag }) => {
    const api = await apiAs("ADMIN");
    // An admin with every branch names the branch, since other tests may add branches.
    await api.post("/api/v1/customers", {
      data: { fullName: `Secrets ${testTag}`, phone: uniquePhone(), branchId: E2E_BRANCH_ID },
    });

    const me = await api.get("/api/v1/me");
    expect(Object.keys(await me.json()).sort()).toEqual([
      "allBranches",
      "branches",
      "dataScopes",
      "email",
      "employeeId",
      "id",
      "locale",
      "maskedFields",
      "name",
      "permissions",
      "role",
    ]);
    for (const path of ["/api/v1/me", "/api/v1/customers"]) {
      expect(await (await api.get(path)).text()).not.toMatch(FORBIDDEN_KEYS);
    }
  });
});
