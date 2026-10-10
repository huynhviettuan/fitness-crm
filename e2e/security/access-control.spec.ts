// OWASP A01:2025 Broken Access Control, A04:2025 Cryptographic Failures (secrets in responses).
import { expect, test } from "../fixtures";
import { discoverApiRoutes } from "../support/routes";
import type { Role } from "../../src/lib/permissions";

const routes = discoverApiRoutes();

test.describe("A01 every API route requires a session", () => {
  test("the route inventory found the API", () => {
    expect(routes.map((r) => r.template)).toEqual(
      expect.arrayContaining(["/api/v1/customers", "/api/v1/customers/[id]", "/api/v1/auth/me"]),
    );
  });

  for (const route of routes) {
    for (const method of route.methods) {
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
    ["MANAGER", 201],
    ["RECEPTIONIST", 201],
    ["TRAINER", 403],
    ["ACCOUNTANT", 403],
  ];

  for (const [role, status] of createExpectations) {
    test(`${role} creating a customer gets ${status}`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/customers", { data: { fullName: `RBAC ${testTag}`, phone: "0909000111" } });

      expect(response.status()).toBe(status);
    });
  }

  for (const role of ["TRAINER", "ACCOUNTANT"] as const) {
    test(`${role} cannot update a customer`, async ({ apiAs, testTag }) => {
      const reception = await apiAs("RECEPTIONIST");
      const customer = await (
        await reception.post("/api/v1/customers", { data: { fullName: `Target ${testTag}`, phone: "0909000222" } })
      ).json();

      const api = await apiAs(role);
      const response = await api.patch(`/api/v1/customers/${customer.id}`, { data: { fullName: "Changed" } });

      expect(response.status()).toBe(403);
      expect((await (await reception.get(`/api/v1/customers/${customer.id}`)).json()).fullName).toBe(`Target ${testTag}`);
    });
  }

  test("a trainer cannot open a customer by id, even with the real id (OQ-006 interim)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await (
      await reception.post("/api/v1/customers", { data: { fullName: `Hidden ${testTag}`, phone: "0909000333" } })
    ).json();

    const trainer = await apiAs("TRAINER");

    expect((await trainer.get(`/api/v1/customers/${customer.id}`)).status()).toBe(404);
    expect((await (await trainer.get(`/api/v1/customers?search=${testTag}`)).json()).total).toBe(0);
  });

  test("fields the client must not control are ignored (mass assignment)", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST");
    const forged = {
      fullName: `Forged ${testTag}`,
      phone: "0909000444",
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

    const patched = await (await api.patch(`/api/v1/customers/${created.id}`, { data: { customerCode: "KH999998" } })).json();
    expect(patched.customerCode).toBe(created.customerCode);
  });

  test("Better Auth endpoints the app does not offer are disabled", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    for (const path of ["/api/auth/sign-up/email", "/api/auth/update-user", "/api/auth/delete-user", "/api/auth/change-email"]) {
      const response = await api.post(path, { data: { email: "x@y.test", password: "Whatever-123", name: "X", role: "ADMIN" } });
      expect(response.status(), path).toBe(404);
    }
  });
});

test.describe("A04 responses never expose secrets", () => {
  const FORBIDDEN_KEYS = /"(password|passwordHash|hash|token|secret)"\s*:/i;

  test("the current-user and customer APIs return only safe fields", async ({ apiAs, testTag }) => {
    const api = await apiAs("ADMIN");
    await api.post("/api/v1/customers", { data: { fullName: `Secrets ${testTag}`, phone: "0909000555" } });

    const me = await api.get("/api/v1/auth/me");
    expect(Object.keys(await me.json()).sort()).toEqual(["email", "id", "locale", "name", "role", "trainerId"]);
    for (const path of ["/api/v1/auth/me", "/api/v1/customers"]) {
      expect(await (await api.get(path)).text()).not.toMatch(FORBIDDEN_KEYS);
    }
  });
});
