// OWASP A01 (access control), A03 (stored script) and A10 (input errors) for the workout plans and templates of M7.2
// (brief §7.2, FR-WKO-002). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const SEE: Role[] = ["ADMIN", "FITNESS_MANAGER", "PT"];
const WRITE: Role[] = ["ADMIN", "FITNESS_MANAGER"];

async function branchOf(apiAs: (role: Role) => Promise<APIRequestContext>) {
  const me = (await (await (await apiAs("ADMIN")).get("/api/v1/me")).json()) as { branches: { id: string }[] };
  return me.branches[0]!.id;
}

test.describe("A01 who reads and writes plans", () => {
  for (const role of ROLES) {
    test(`${role} listing plans gets ${SEE.includes(role) ? 200 : 403}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      expect((await api.get("/api/v1/workout/plans")).status()).toBe(SEE.includes(role) ? 200 : 403);
      expect((await api.get(`/api/v1/workout/plans/${randomUUID()}`)).status()).toBe(SEE.includes(role) ? 404 : 403);
    });

    test(`${role} creating a template gets ${WRITE.includes(role) ? 201 : 403}`, async ({ apiAs, testTag }) => {
      if (role === "PT") return;
      const branchId = await branchOf(apiAs);
      const response = await (
        await apiAs(role)
      ).post("/api/v1/workout/plans", {
        data: { kind: "TEMPLATE", name: `Template ${role} ${testTag}`, branchId },
      });
      expect(response.status()).toBe(WRITE.includes(role) ? 201 : 403);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/workout/plans")).status()).toBe(401);
    expect((await anonymous.post("/api/v1/workout/plans", { data: {} })).status()).toBe(401);
    expect((await anonymous.put(`/api/v1/workout/plans/${randomUUID()}`, { data: {} })).status()).toBe(401);
    expect((await anonymous.post(`/api/v1/workout/plans/${randomUUID()}/submit`)).status()).toBe(401);
  });

  test("a PT cannot change a template or someone else's plan, and the submitter cannot approve", async ({
    apiAs,
    testTag,
  }) => {
    const branchId = await branchOf(apiAs);
    const template = (await (
      await (
        await apiAs("ADMIN")
      ).post("/api/v1/workout/plans", { data: { kind: "TEMPLATE", name: `Template ${testTag}`, branchId } })
    ).json()) as { id: string };
    const pt = await apiAs("PT");
    const body = { data: { name: `Đổi ${testTag}`, stages: [] } };
    expect([403, 404]).toContain((await pt.put(`/api/v1/workout/plans/${template.id}`, body)).status());
    expect([403, 404]).toContain((await pt.post(`/api/v1/workout/plans/${template.id}/submit`)).status());
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a script in a name is kept as text and a bad request is a 400 or 404", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const branchId = await branchOf(apiAs);
    const script = `<script>alert(1)</script> ${testTag}`;
    const stored = await admin.post("/api/v1/workout/plans", { data: { kind: "TEMPLATE", name: script, branchId } });
    expect(stored.status()).toBe(201);
    expect(await stored.json()).toMatchObject({ name: script });

    for (const data of [
      {},
      { kind: "YOGA" },
      { kind: "TEMPLATE", name: "", branchId },
      { kind: "TEMPLATE", name: "a\u0007b", branchId },
      { kind: "TEMPLATE", name: "x".repeat(300), branchId },
      { kind: "TEMPLATE", name: `T ${testTag}`, branchId: "nope" },
      { kind: "CUSTOMER", customerId: "nope", contractId: randomUUID(), trainerId: randomUUID() },
    ]) {
      const response = await admin.post("/api/v1/workout/plans", { data });
      expect(response.status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    const missing = await admin.post("/api/v1/workout/plans", {
      data: { kind: "CUSTOMER", customerId: randomUUID(), contractId: randomUUID(), trainerId: randomUUID() },
    });
    expect([400, 404]).toContain(missing.status());
    expect((await admin.get("/api/v1/workout/plans/not-a-uuid")).status()).toBe(404);
    for (const query of ["kind=YOGA", "status=NOPE", "pageSize=101", "page=0"]) {
      expect((await admin.get(`/api/v1/workout/plans?${query}`)).status(), query).toBe(400);
    }
  });
});
