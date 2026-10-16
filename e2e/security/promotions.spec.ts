// OWASP A01 (access control, voucher codes), A03/A10 (input errors, mass assignment) for the promotion routes and the
// role's discount limit (M4.2, FR-SVC-004, FR-PLT-002). Route-level 401s are covered by the route inventory in
// access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { gymDay } from "../support/data";

const branchId = "b0000000-0000-4000-8000-000000000001";
const tiers = [{ minSessions: 1, maxSessions: 100, unitPrice: 1000000, validityMonths: 1, validityDays: 0 }];

test.describe("A01 who may manage promotions (docs/09)", () => {
  for (const role of ["FITNESS_MANAGER", "CONSULTING", "RECEPTIONIST", "ACCOUNTANT", "PT"] as const) {
    test(`${role} cannot create or change a promotion or a voucher`, async ({ apiAs, testTag }) => {
      const admin = await apiAs("ADMIN");
      const made = await admin.post("/api/v1/promotions", {
        data: { kind: "PROMOTION", name: `P ${testTag}`, discountType: "PERCENT", value: "5" },
      });
      const { id } = (await made.json()) as { id: string };
      const api = await apiAs(role);

      const create = await api.post("/api/v1/promotions", {
        data: { kind: "PROMOTION", name: `Q ${testTag}`, discountType: "PERCENT", value: "5" },
      });
      const change = await api.patch(`/api/v1/promotions/${id}`, {
        data: { kind: "PROMOTION", name: `R ${testTag}`, discountType: "PERCENT", value: "50" },
      });

      expect(create.status()).toBe(403);
      expect(change.status()).toBe(403);
    });
  }
});

test.describe("A01 voucher codes stay with Admin", () => {
  test("staff see the promotions on offer but never a voucher or its code", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const code = `SECRET-${testTag.toUpperCase()}`;
    await admin.post("/api/v1/promotions", {
      data: { kind: "VOUCHER", name: `Voucher ${testTag}`, code, discountType: "PERCENT", value: "50" },
    });
    await admin.post("/api/v1/promotions", {
      data: { kind: "PROMOTION", name: `Promo ${testTag}`, discountType: "PERCENT", value: "5" },
    });

    for (const role of ["RECEPTIONIST", "CONSULTING"] as const) {
      const api = await apiAs(role);
      for (const url of ["/api/v1/promotions", "/api/v1/promotions?kind=VOUCHER", "/api/v1/promotions?onOffer=true"]) {
        const response = await api.get(url);
        expect(response.status()).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(code);
        expect(text).not.toContain(`Voucher ${testTag}`);
      }
      const names = (
        (await (await api.get("/api/v1/promotions")).json()) as { items: { name: string; code: string | null }[] }
      ).items;
      expect(names.some((item) => item.name === `Promo ${testTag}`)).toBe(true);
      expect(names.every((item) => item.code === null)).toBe(true);
    }
    const adminList = (await (await admin.get("/api/v1/promotions")).json()) as { items: { code: string | null }[] };
    expect(adminList.items.map((item) => item.code)).toContain(code);
  });

  test("a trainer, who may not read services, may not read promotions", async ({ apiAs }) => {
    expect((await (await apiAs("PT")).get("/api/v1/promotions")).status()).toBe(403);
  });
});

test.describe("A10 input errors and the quote", () => {
  test("bad values are 400s, and a promotion that cannot be used is refused", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const post = (data: Record<string, unknown>) => admin.post("/api/v1/promotions", { data });
    const base = { kind: "PROMOTION", name: `P ${testTag}`, discountType: "PERCENT", value: "10" };

    expect((await post({ ...base, value: "101" })).status()).toBe(400);
    expect((await post({ ...base, discountType: "AMOUNT", value: "10.5" })).status()).toBe(400);
    expect((await post({ ...base, kind: "VOUCHER" })).status()).toBe(400);
    expect((await post({ ...base, code: "ABC" })).status()).toBe(400);
    expect((await post({ ...base, validFrom: "10/10/2026", validTo: "01/10/2026" })).status()).toBe(400);
    expect((await post({ ...base, name: `P ${testTag}\r\nX` })).status()).toBe(400);
    expect((await post({ ...base, serviceIds: [randomUUID()] })).status()).toBe(400);
    expect((await admin.patch(`/api/v1/promotions/${randomUUID()}`, { data: base })).status()).toBe(404);

    const made = await admin.post("/api/v1/services", {
      data: { name: `Gói ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const { id } = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(-1), tiers } });
    const quote = (query: string) => admin.get(`/api/v1/services/${id}/quote?sessions=10${query}`);
    expect((await quote("&promotionId=not-a-uuid")).status()).toBe(400);
    expect((await quote(`&promotionId=${randomUUID()}`)).status()).toBe(400);
    expect((await quote("&voucherCode=NOPE")).status()).toBe(400);
    expect((await quote("&vatPercent=101")).status()).toBe(400);
    expect((await quote("&vatPercent=abc")).status()).toBe(400);
    expect((await quote("")).status()).toBe(200);
  });

  test("the quote's price comes from the tiers, not from the query", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Giá ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const { id } = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${id}/tiers`, { data: { effectiveFrom: gymDay(-1), tiers } });

    const body = (await (
      await admin.get(`/api/v1/services/${id}/quote?sessions=10&unitPrice=1&totalDiscount=999999999&total=1`)
    ).json()) as {
      breakdown: { gross: number; total: number };
    };

    expect(body.breakdown).toMatchObject({ gross: 10_000_000, total: 10_000_000 });
  });

  test("the role's discount limit is a percent from 0 to 100", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const scopes = Object.fromEntries(
      ["leads", "customers", "contracts", "schedule", "vouchers", "staff", "tasks"].map((key) => [key, "OWN"]),
    );
    const role = (limit: string) =>
      admin.post("/api/v1/roles", {
        data: {
          name: `Vai trò ${limit} ${testTag}`,
          permissions: [],
          dataScopes: scopes,
          fieldMasks: [],
          discountThresholdPct: limit,
        },
      });

    expect((await role("-1")).status()).toBe(400);
    expect((await role("101")).status()).toBe(400);
    expect((await role("abc")).status()).toBe(400);
    expect((await role("12.5")).status()).toBe(201);
  });
});
