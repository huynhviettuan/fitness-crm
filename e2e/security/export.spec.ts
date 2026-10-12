// OWASP A01 (access control, data scope, masking), A03 (formula injection in files), A09
// (audit) and A10 (input errors) for M3 slice 1: export to Excel from every list (brief §1,
// §2; D-017; A-077 to A-080). Route-level 401s and 403s for every operation are also walked
// by permissions.spec.ts and access-control.spec.ts. The row limit is a global parameter, so
// its HTTP test is in export-limit.branch.spec.ts.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createUserViaApi } from "../support/admin";
import { createLeadViaApi, uniquePhone } from "../support/data";
import type { Role } from "../support/db";
import { readBody } from "../support/xlsx";

const SCOPES_ALL = {
  leads: "ALL",
  customers: "ALL",
  contracts: "ALL",
  schedule: "ALL",
  vouchers: "ALL",
  staff: "ALL",
  tasks: "ALL",
};
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Every export endpoint and the roles that hold its permission by default (A-077). */
const EXPORTS: { path: string; permission: string; allowed: Role[] }[] = [
  { path: "customers", permission: "customer.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "leads", permission: "lead.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "contracts", permission: "contract.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "payments", permission: "payment.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "cash-transactions", permission: "cash.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "tasks", permission: "task.export", allowed: ["ADMIN", "FITNESS_MANAGER"] },
  { path: "audit-events", permission: "audit.export", allowed: ["ADMIN"] },
  { path: "trash", permission: "trash.export", allowed: ["ADMIN"] },
  { path: "users", permission: "user.export", allowed: ["ADMIN"] },
];
const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];

/** A signed-in user of a role made for the test. */
async function userWithRole(
  apiAs: (role: Role | null) => Promise<APIRequestContext>,
  apiSignedIn: (email: string, password: string) => Promise<APIRequestContext>,
  tag: string,
  role: { permissions: string[]; fieldMasks?: string[] },
) {
  const admin = await apiAs("ADMIN");
  const created = await admin.post("/api/v1/roles", {
    data: { name: `Vai trò ${tag}`, dataScopes: SCOPES_ALL, fieldMasks: [], ...role },
  });
  expect(created.status()).toBe(201);
  const user = await createUserViaApi(admin, tag, { roleId: (await created.json()).id, label: "Custom" });
  return apiSignedIn(user.email, user.password);
}

test.describe("A01 who may export which list (A-077)", () => {
  for (const { path, allowed } of EXPORTS) {
    for (const role of ROLES) {
      const status = allowed.includes(role) ? 200 : 403;
      test(`${role} exporting /${path} gets ${status}`, async ({ apiAs }) => {
        const api = await apiAs(role);

        const response = await api.get(`/api/v1/${path}/export`);

        // A role that may export a list but not see it is also refused (the list's own check).
        expect(response.status()).toBe(status);
        if (status === 200) {
          expect(response.headers()["content-type"]).toBe(XLSX);
          expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="[a-z-]+-\d{8}\.xlsx"$/);
          expect(response.headers()["cache-control"]).toBe("no-store");
        } else {
          // A refusal is the documented JSON error, never part of a file.
          expect(response.headers()["content-type"]).toContain("application/json");
          expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
        }
      });
    }

    test(`an anonymous request for /${path}/export gets 401`, async ({ apiAs }) => {
      const response = await (await apiAs(null)).get(`/api/v1/${path}/export`);

      expect(response.status()).toBe(401);
    });
  }

  test("the export permission is not enough without the permission to see the list", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const exportOnly = await userWithRole(apiAs, apiSignedIn, testTag, { permissions: ["customer.export"] });

    expect((await exportOnly.get("/api/v1/customers/export")).status()).toBe(403);
    expect((await exportOnly.get("/api/v1/customers")).status()).toBe(403);
  });

  test("the permission to see the list is not enough without the export permission", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const viewOnly = await userWithRole(apiAs, apiSignedIn, testTag, { permissions: ["customer.view"] });

    expect((await viewOnly.get("/api/v1/customers")).status()).toBe(200);
    expect((await viewOnly.get("/api/v1/customers/export")).status()).toBe(403);
  });
});

test.describe("A01 masks and scope in the file (D-017, AC-01)", () => {
  test("a hidden phone, email, and address are not columns of the file, and appear nowhere in it", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const phone = uniquePhone();
    const email = `${testTag.toLowerCase()}@example.com`;
    const created = await (
      await apiAs("RECEPTIONIST")
    ).post("/api/v1/customers", {
      data: { fullName: `Ẩn ${testTag}`, phone, email, address: `Số 9 phố ${testTag}`, emergencyContactName: "Lê D" },
    });
    expect(created.status()).toBe(201);
    const masked = await userWithRole(apiAs, apiSignedIn, testTag, {
      permissions: ["customer.view", "customer.export"],
      fieldMasks: ["customer.phone", "customer.email", "customer.address"],
    });

    const hidden = await readBody(await (await masked.get(`/api/v1/customers/export?search=${testTag}`)).body());
    const full = await readBody(
      await (await (await apiAs("FITNESS_MANAGER")).get(`/api/v1/customers/export?search=${testTag}`)).body(),
    );

    expect(hidden.rows).toHaveLength(1);
    for (const column of ["Số điện thoại", "Email", "Địa chỉ", "Liên hệ khẩn cấp"]) {
      expect(hidden.header).not.toContain(column);
      expect(full.header).toContain(column);
    }
    const text = JSON.stringify(hidden);
    expect(text).not.toContain(phone.slice(1));
    expect(text).not.toContain(email);
    expect(text).not.toContain("phố");
    // Searching by a hidden phone finds nothing either, in the file as on the screen.
    const probe = await readBody(await (await masked.get(`/api/v1/customers/export?search=${phone}`)).body());
    expect(probe.rows).toHaveLength(0);
  });

  test("the lead export leaves out a hidden phone and email too", async ({ apiAs, apiSignedIn, testTag }) => {
    const phone = uniquePhone();
    await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ẩn ${testTag}`, phone });
    const masked = await userWithRole(apiAs, apiSignedIn, testTag, {
      permissions: ["lead.view", "lead.export"],
      fieldMasks: ["customer.phone", "customer.email"],
    });

    const file = await readBody(await (await masked.get(`/api/v1/leads/export?q=${testTag}`)).body());

    expect(file.rows).toHaveLength(1);
    expect(file.header).not.toContain("Số điện thoại");
    expect(JSON.stringify(file)).not.toContain(phone.slice(1));
  });

  test("the file holds the same rows as the list for the same filters, never more", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    for (const name of ["một", "hai", "ba"]) {
      await reception.post("/api/v1/customers", {
        data: { fullName: `Dòng ${name} ${testTag}`, phone: uniquePhone() },
      });
    }
    const manager = await apiAs("FITNESS_MANAGER");

    const list = (await (await manager.get(`/api/v1/customers?search=${testTag}&pageSize=1`)).json()) as {
      total: number;
      items: unknown[];
    };
    const file = await readBody(
      await (await manager.get(`/api/v1/customers/export?search=${testTag}&pageSize=1&page=2`)).body(),
    );

    expect(list.items).toHaveLength(1);
    // The file ignores the page of the screen: it has every row of the filtered list.
    expect(file.rows).toHaveLength(list.total);
    expect(list.total).toBe(3);
  });
});

test.describe("A03 text that looks like a formula", () => {
  test("is written as text, never as a formula", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const payload = `=HYPERLINK("http://evil.example/${testTag}","x")`;
    await reception.post("/api/v1/customers", { data: { fullName: payload, phone: uniquePhone() } });
    const manager = await apiAs("FITNESS_MANAGER");

    const response = await manager.get("/api/v1/customers/export?search=HYPERLINK");
    const file = await readBody(await response.body());

    const row = file.rows.find((r) => String(r[1]).includes(testTag));
    expect(row?.[1]).toBe(payload);
    // A formula cell would come back as { formula, result }, not as the string.
    expect(typeof row?.[1]).toBe("string");
  });
});

test.describe("A09 every export is audited (A-080)", () => {
  test("who, which list, the filters, and the row count are recorded; the search text is not", async ({
    apiAs,
    testTag,
  }) => {
    const phone = uniquePhone();
    await (await apiAs("RECEPTIONIST")).post("/api/v1/customers", { data: { fullName: `Có vết ${testTag}`, phone } });
    const manager = await apiAs("FITNESS_MANAGER");
    const admin = await apiAs("ADMIN");
    const managerId = ((await (await manager.get("/api/v1/me")).json()) as { id: string }).id;

    expect((await manager.get(`/api/v1/customers/export?search=${phone}&noEmail=true`)).status()).toBe(200);

    const history = (await (
      await admin.get(`/api/v1/audit-events?entityType=export&actorUserId=${managerId}`)
    ).json()) as {
      items: { action: string; after: Record<string, unknown> }[];
    };
    const event = history.items.find(
      (item) => (item.after.filters as Record<string, unknown>)?.noEmail === "true" && item.after.list === "customers",
    );
    expect(event).toMatchObject({ action: "export.downloaded", after: { rowCount: 1 } });
    expect(JSON.stringify(history)).not.toContain(phone);
    expect(event?.after.filters).toEqual({ search: true, noEmail: "true" });
  });

  test("a refused export leaves no event", async ({ apiAs }) => {
    const receptionist = await apiAs("RECEPTIONIST");
    const admin = await apiAs("ADMIN");
    const receptionistId = ((await (await receptionist.get("/api/v1/me")).json()) as { id: string }).id;
    // Only this user's events: other tests export at the same time.
    const count = async () =>
      (
        (await (await admin.get(`/api/v1/audit-events?entityType=export&actorUserId=${receptionistId}`)).json()) as {
          total: number;
        }
      ).total;
    const before = await count();

    expect((await receptionist.get("/api/v1/customers/export")).status()).toBe(403);

    expect(await count()).toBe(before);
  });
});

test.describe("A10 export input errors", () => {
  test("bad filters are 400 with field errors, and the answer is never a file", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const bad = async (path: string) => {
      const response = await manager.get(`/api/v1/${path}`);
      expect(response.status(), path).toBe(400);
      expect(response.headers()["content-type"], path).toContain("application/json");
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    };

    await bad("customers/export?birthdayMonth=13");
    await bad("customers/export?staffId=x");
    await bad("leads/export?status=NOPE");
    await bad("tasks/export?view=everyone");
    await bad("payments/export?from=31/02/2026");
  });

  test("the page and the page size of the screen are ignored", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    for (const query of ["page=-1", "pageSize=0", "page=abc&pageSize=100000"]) {
      const response = await manager.get(`/api/v1/customers/export?${query}`);
      expect(response.status(), query).toBe(200);
    }
  });

  test("only GET exports: other methods on the route are refused", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");

    for (const method of ["post", "put", "patch", "delete"] as const) {
      const response = await admin[method]("/api/v1/customers/export", { data: {} });
      expect([400, 404, 405], method).toContain(response.status());
    }
  });
});
