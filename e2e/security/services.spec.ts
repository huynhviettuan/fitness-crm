// OWASP A01 (access control, branch scope, mass assignment), A03/A10 (input errors) for the service routes
// (M4.1, FR-SVC-001 to FR-SVC-003). Route-level 401s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { gymDay } from "../support/data";
import type { Role } from "../support/db";

const branchId = "b0000000-0000-4000-8000-000000000001";
const tiers = [{ minSessions: 1, maxSessions: 20, unitPrice: 100000, validityMonths: 1, validityDays: 0 }];

test.describe("A01 who may read and change services (docs/09)", () => {
  const readExpectations: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["ACCOUNTANT", 200],
    ["PT", 403],
  ];
  for (const [role, status] of readExpectations) {
    test(`${role} reading the service list gets ${status}`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/services")).status()).toBe(status);
    });
  }

  for (const role of ["FITNESS_MANAGER", "CONSULTING", "RECEPTIONIST", "ACCOUNTANT", "PT"] as const) {
    test(`${role} cannot create a service, a price version, or quick-pick counts`, async ({ apiAs, testTag }) => {
      const admin = await apiAs("ADMIN");
      const made = await admin.post("/api/v1/services", {
        data: { name: `Dịch vụ ${testTag}`, kind: "PT", branchIds: [branchId] },
      });
      const { id } = (await made.json()) as { id: string };
      const api = await apiAs(role);

      expect(
        (
          await api.post("/api/v1/services", { data: { name: `Khác ${testTag}`, kind: "PT", branchIds: [branchId] } })
        ).status(),
      ).toBe(403);
      expect(
        (
          await api.patch(`/api/v1/services/${id}`, {
            data: { name: `Đổi ${testTag}`, kind: "PT", branchIds: [branchId] },
          })
        ).status(),
      ).toBe(403);
      expect(
        (await api.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(0), tiers } })).status(),
      ).toBe(403);
      expect((await api.put(`/api/v1/services/${id}/quick-packages`, { data: { sessions: [12] } })).status()).toBe(403);
    });
  }
});

test.describe("A01 branch scope and the lookup", () => {
  test("a service of another branch is NOT_FOUND for someone who sells only in the default branch", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const branch = await admin.post("/api/v1/branches", { data: { name: `Chi nhánh ${testTag}` } });
    const { id: otherBranch } = (await branch.json()) as { id: string };
    const made = await admin.post("/api/v1/services", {
      data: { name: `Xa ${testTag}`, kind: "PT", branchIds: [otherBranch] },
    });
    const { id } = (await made.json()) as { id: string };

    const reception = await apiAs("RECEPTIONIST");
    expect((await reception.get(`/api/v1/services/${id}`)).status()).toBe(404);
    expect((await reception.get(`/api/v1/services/${id}/lookup?sessions=5`)).status()).toBe(404);
    const listed = (await (await reception.get("/api/v1/services")).json()) as { items: { id: string }[] };
    expect(listed.items.map((item) => item.id)).not.toContain(id);
  });

  test("the unit price is looked up, never taken from the client", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Giá ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const { id } = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(-1), tiers } });
    const reception = await apiAs("RECEPTIONIST");

    const url = `/api/v1/services/${id}/lookup?sessions=10&unitPrice=1&total=1`;
    const body = (await (await reception.get(url)).json()) as { unitPrice: number; total: number };

    expect(body).toMatchObject({ unitPrice: 100000, total: 1_000_000 });
  });
});

test.describe("A10 input errors", () => {
  test("bad ids, counts, tiers, and dates are 4xx answers, not server errors", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Lỗi ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const { id } = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(-1), tiers } });

    expect((await admin.get(`/api/v1/services/${randomUUID()}`)).status()).toBe(404);
    expect((await admin.get("/api/v1/services/not-a-uuid")).status()).toBe(404);
    expect((await admin.get(`/api/v1/services/${id}/lookup?sessions=abc`)).status()).toBe(400);
    expect((await admin.get(`/api/v1/services/${id}/lookup?sessions=21`)).status()).toBe(400);
    expect((await admin.get(`/api/v1/services/${id}/lookup`)).status()).toBe(400);
    expect(
      (await admin.post("/api/v1/services", { data: { name: "", kind: "PT", branchIds: [branchId] } })).status(),
    ).toBe(400);
    expect(
      (
        await admin.post("/api/v1/services", { data: { name: `K ${testTag}`, kind: "BAD", branchIds: [branchId] } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await admin.post("/api/v1/services", { data: { name: `L ${testTag}\r\nX`, kind: "PT", branchIds: [branchId] } })
      ).status(),
    ).toBe(400);
    expect(
      (await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(5), tiers: [] } })).status(),
    ).toBe(400);
    expect((await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: "nope", tiers } })).status()).toBe(
      400,
    );
    expect(
      (await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(-9), tiers } })).status(),
    ).toBe(400);
  });
});
