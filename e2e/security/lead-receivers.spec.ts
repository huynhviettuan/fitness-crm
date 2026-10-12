// OWASP A01 (access control, data scope, personal data) and A10 (input errors) for M2.7 step 3: the
// consultants who receive leads, their turn weight, and the switch for receiving (D-050). Route-level
// 401s and 403s for every operation are also walked by permissions.spec.ts and access-control.spec.ts.
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
/** Who reassigns leads holds `lead.assign` (09_RBAC.md). */
const MAY: Role[] = ["ADMIN", "FITNESS_MANAGER"];
const NOBODY = "00000000-0000-4000-8000-0000000000ee";

test.describe("A01 who sees and changes who receives leads", () => {
  for (const role of ROLES) {
    const status = MAY.includes(role) ? 200 : 403;
    test(`${role} reading the receivers gets ${status}`, async ({ apiAs }) => {
      const response = await (await apiAs(role)).get("/api/v1/lead-receivers");

      expect(response.status()).toBe(status);
      if (status === 403) expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    });

    test(`${role} changing a consultant's receiving gets ${status === 200 ? "a good answer" : "403"}`, async ({
      apiAs,
    }) => {
      const manager = await apiAs("FITNESS_MANAGER");
      const list = (await (await manager.get("/api/v1/lead-receivers")).json()) as {
        items: { id: string; receivesLeads: boolean; leadWeight: number }[];
      };
      const consultant = list.items[0];

      // The same values as now, so a manager's request changes nothing for the other specs.
      const response = await (
        await apiAs(role)
      ).put(`/api/v1/lead-receivers/${consultant.id}`, {
        data: { receivesLeads: consultant.receivesLeads, leadWeight: consultant.leadWeight },
      });

      expect(response.status()).toBe(status);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);

    expect((await anonymous.get("/api/v1/lead-receivers")).status()).toBe(401);
    expect(
      (
        await anonymous.put(`/api/v1/lead-receivers/${NOBODY}`, { data: { receivesLeads: true, leadWeight: 1 } })
      ).status(),
    ).toBe(401);
  });

  test("the list names consultants and their settings, never an email, a phone, or a password", async ({ apiAs }) => {
    const text = JSON.stringify(await (await (await apiAs("FITNESS_MANAGER")).get("/api/v1/lead-receivers")).json());

    expect(text).not.toMatch(/"(email|phone|password|passwordHash)"/);
    expect(JSON.parse(text).items.every((item: { role: { name: string } }) => item.role.name.length > 0)).toBe(true);
  });

  test("only people who receive leads are listed, so a receptionist's record is not reachable here", async ({
    apiAs,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const me = (await (await (await apiAs("RECEPTIONIST")).get("/api/v1/me")).json()) as { id: string };

    const response = await manager.put(`/api/v1/lead-receivers/${me.id}`, {
      data: { receivesLeads: false, leadWeight: 5 },
    });

    expect(response.status()).toBe(404);
  });
});

test.describe("A10 input errors", () => {
  test("a weight out of range, not whole, or a switch that is not a boolean is 400 with field errors", async ({
    apiAs,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const list = (await (await manager.get("/api/v1/lead-receivers")).json()) as { items: { id: string }[] };
    const id = list.items[0].id;
    const bad = async (data: unknown, field: string) => {
      const response = await manager.put(`/api/v1/lead-receivers/${id}`, { data: data as Record<string, unknown> });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect((await response.json()).details.fieldErrors).toHaveProperty(field);
    };

    await bad({ receivesLeads: true, leadWeight: 0 }, "leadWeight");
    await bad({ receivesLeads: true, leadWeight: 21 }, "leadWeight");
    await bad({ receivesLeads: true, leadWeight: 1.5 }, "leadWeight");
    await bad({ receivesLeads: true, leadWeight: "2" }, "leadWeight");
    await bad({ receivesLeads: "yes", leadWeight: 1 }, "receivesLeads");
    await bad({ leadWeight: 1 }, "receivesLeads");
    await bad({ receivesLeads: true }, "leadWeight");
  });

  test("an unknown or malformed user is 404", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const data = { receivesLeads: true, leadWeight: 1 };

    expect((await manager.put(`/api/v1/lead-receivers/${NOBODY}`, { data })).status()).toBe(404);
    expect((await manager.put("/api/v1/lead-receivers/not-a-uuid", { data })).status()).toBe(404);
  });

  test("only GET reads and only PUT changes", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");

    for (const method of ["post", "patch", "delete"] as const) {
      const response = await admin[method]("/api/v1/lead-receivers", { data: {} });
      expect([404, 405], method).toContain(response.status());
    }
  });
});
