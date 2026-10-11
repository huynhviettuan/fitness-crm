// OWASP A01 (access control, data scope, masking, mass assignment) and A10 (input errors)
// for M2 slice 5: the re-care list, inquiries on an existing record, and merging two records
// of one person (brief §4.1, BR-202, D-019, A-063..A-067). Route-level 401s and 403s for
// every operation are also walked by permissions.spec.ts and access-control.spec.ts; tests
// that need a second branch with consultants are in lead-merge.branch.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createUserViaApi } from "../support/admin";
import {
  createCustomerViaApi,
  createLeadViaApi,
  leadChannelId,
  leadInRecareViaApi,
  uniquePhone,
} from "../support/data";
import type { Role } from "../support/db";
import { otherOptionId } from "../support/options";

const SCOPES_ALL = {
  leads: "ALL",
  customers: "ALL",
  contracts: "ALL",
  schedule: "ALL",
  vouchers: "ALL",
  staff: "ALL",
  tasks: "ALL",
};

/** A merge body with "Khác" and a note, the reason every merge here gives. */
async function mergeBody(api: APIRequestContext, mergedId: string, extra: Record<string, unknown> = {}) {
  return {
    mergedId,
    reasonId: await otherOptionId(api, "deleteReasons"),
    reasonNote: "Cùng một người",
    ...extra,
  };
}

/** Two leads of the shared branch, both in the E2E consultant's charge. */
async function twoLeads(apiAs: (role: Role) => Promise<APIRequestContext>, tag: string) {
  const reception = await apiAs("RECEPTIONIST");
  const first = await createLeadViaApi(reception, { fullName: `Lead một ${tag}`, phone: uniquePhone() });
  const second = await createLeadViaApi(reception, { fullName: `Lead hai ${tag}`, phone: uniquePhone() });
  return { first, second };
}

/** A signed-in user of a role made for the test, with the given permissions and field masks. */
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

test.describe("A01 merging two records (A-065)", () => {
  const mergers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of mergers) {
    test(`${role} merging two records gets ${status} (lead.merge)`, async ({ apiAs, testTag }) => {
      const { first, second } = await twoLeads(apiAs, testTag);
      const api = await apiAs(role);

      const response = await api.post(`/api/v1/persons/${first.id}/merge`, {
        data: await mergeBody(await apiAs("ADMIN"), second.id),
      });

      expect(response.status()).toBe(status);
      // A refusal changes nothing.
      if (status === 403) {
        const admin = await apiAs("ADMIN");
        expect((await admin.get(`/api/v1/leads/${first.id}`)).status()).toBe(200);
        expect((await admin.get(`/api/v1/leads/${second.id}`)).status()).toBe(200);
      }
    });
  }

  test("the survivor, the merged record, and who merged are the server's choice (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const { first, second } = await twoLeads(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const adminId = (await (await admin.get("/api/v1/me")).json()).id;

    // `first` was created first, so it survives whatever the body says.
    const response = await admin.post(`/api/v1/persons/${second.id}/merge`, {
      data: await mergeBody(admin, first.id, {
        survivorId: second.id,
        mergedById: randomUUID(),
        stage: "CUSTOMER",
        branchId: randomUUID(),
        mergedIntoId: randomUUID(),
      }),
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ survivorId: first.id, mergedId: second.id, stage: "LEAD" });
    const gone = await admin.get(`/api/v1/leads/${second.id}`);
    expect(gone.status()).toBe(404);
    const timeline = (await (await admin.get(`/api/v1/leads/${first.id}/timeline`)).json()) as {
      items: { kind: string; by?: { id: string } | null }[];
    };
    expect(timeline.items.find((item) => item.kind === "merge")?.by?.id).toBe(adminId);
  });

  test("a merged record is gone from the lists, the search, and the phone check, and its phone stays with the survivor", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const admin = await apiAs("ADMIN");
    const quiet = await reception.post("/api/v1/leads", {
      data: { fullName: `Không số ${testTag}`, channelId: await leadChannelId(reception, "WhatsApp") },
    });
    const phone = uniquePhone();
    const withPhone = await createLeadViaApi(reception, { fullName: `Có số ${testTag}`, phone });
    const quietLead = (await quiet.json()) as { id: string };

    const merged = await admin.post(`/api/v1/persons/${withPhone.id}/merge`, {
      data: await mergeBody(admin, quietLead.id),
    });

    expect(merged.status()).toBe(200);
    const { survivorId, mergedId } = (await merged.json()) as { survivorId: string; mergedId: string };
    const list = (await (await admin.get(`/api/v1/leads?q=${testTag}`)).json()) as { items: { id: string }[] };
    expect(list.items.map((lead) => lead.id)).toEqual([survivorId]);
    expect(list.items.map((lead) => lead.id)).not.toContain(mergedId);
    const again = await reception.post("/api/v1/leads", {
      data: { fullName: `Lại ${testTag}`, phone, channelId: await leadChannelId(reception, "WhatsApp") },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: "DUPLICATE_PHONE", details: { duplicate: { id: survivorId } } });
  });
});

test.describe("A10 merge input errors", () => {
  test("a missing reason, Khác without a note, control characters, and bad ids are 400 with field errors", async ({
    apiAs,
    testTag,
  }) => {
    const { first, second } = await twoLeads(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const other = await otherOptionId(admin, "deleteReasons");
    const post = (data: unknown) => admin.post(`/api/v1/persons/${first.id}/merge`, { data });
    const errors = async (data: unknown) => {
      const response = await post(data);
      expect(response.status()).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors({ mergedId: second.id })).toMatchObject({ reasonId: ["required"] });
    expect(await errors({ mergedId: second.id, reasonId: other, reasonNote: "" })).toMatchObject({
      reasonNote: ["otherNeedsNote"],
    });
    expect(await errors({ mergedId: second.id, reasonId: other, reasonNote: "a\u0000b" })).toMatchObject({
      reasonNote: ["invalidCharacters"],
    });
    expect(await errors({ mergedId: second.id, reasonId: randomUUID() })).toMatchObject({
      reasonId: ["invalidChoice"],
    });
    expect(await errors({ mergedId: "not-a-uuid", reasonId: other, reasonNote: "x" })).toMatchObject({
      mergedId: ["required"],
    });
    expect(await errors({})).toMatchObject({ mergedId: ["required"], reasonId: ["required"] });
    // Nothing happened.
    expect((await admin.get(`/api/v1/leads/${second.id}`)).status()).toBe(200);
  });

  test("a record merged with itself is 400; an unknown or malformed id is 404; two customers is 409", async ({
    apiAs,
    testTag,
  }) => {
    const { first } = await twoLeads(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const reception = await apiAs("RECEPTIONIST");
    const body = (mergedId: string) => mergeBody(admin, mergedId);

    expect((await admin.post(`/api/v1/persons/${first.id}/merge`, { data: await body(first.id) })).status()).toBe(400);
    expect((await admin.post(`/api/v1/persons/${first.id}/merge`, { data: await body(randomUUID()) })).status()).toBe(
      404,
    );
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const response = await admin.post(`/api/v1/persons/${id}/merge`, { data: await body(first.id) });
      expect([400, 404], `merge path ${id}`).toContain(response.status());
    }

    const one = await createCustomerViaApi(reception, `${testTag}a`);
    const two = await createCustomerViaApi(reception, `${testTag}b`);
    const customers = await admin.post(`/api/v1/persons/${one.id}/merge`, { data: await body(two.id) });
    expect(customers.status()).toBe(409);
    expect((await customers.json()).code).toBe("MERGE_CUSTOMERS_UNSUPPORTED");
    expect((await admin.get(`/api/v1/customers/${two.id}`)).status()).toBe(200);
  });

  test("the same pair merged twice is 409 the second time, and exactly one merge happens when they arrive together", async ({
    apiAs,
    testTag,
  }) => {
    const { first, second } = await twoLeads(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const manager = await apiAs("FITNESS_MANAGER");
    const body = await mergeBody(admin, second.id);

    const together = await Promise.all([
      admin.post(`/api/v1/persons/${first.id}/merge`, { data: body }),
      manager.post(`/api/v1/persons/${first.id}/merge`, { data: body }),
    ]);

    expect(together.map((response) => response.status()).sort()).toEqual([200, 409]);
    const refused = together.find((response) => response.status() === 409)!;
    expect((await refused.json()).code).toBe("PERSON_ALREADY_MERGED");
    const later = await admin.post(`/api/v1/persons/${first.id}/merge`, { data: body });
    expect(later.status()).toBe(409);
    expect((await later.json()).code).toBe("PERSON_ALREADY_MERGED");
  });
});

test.describe("A01 inquiries on an existing record (A-063)", () => {
  const inquirers: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["CONSULTING", 201],
    ["RECEPTIONIST", 201],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of inquirers) {
    test(`${role} adding an inquiry gets ${status} (lead.create)`, async ({ apiAs, testTag }) => {
      const reception = await apiAs("RECEPTIONIST");
      const lead = await createLeadViaApi(reception, { fullName: `Lead ${testTag}`, phone: uniquePhone() });

      const response = await (
        await apiAs(role)
      ).post(`/api/v1/persons/${lead.id}/inquiries`, {
        data: { channelId: await leadChannelId(reception, "Zalo"), note: "Hỏi lại" },
      });

      expect(response.status()).toBe(status);
    });
  }

  const readers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of readers) {
    test(`${role} reading the intake history gets ${status} (lead.view)`, async ({ apiAs, testTag }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });

      const response = await (await apiAs(role)).get(`/api/v1/persons/${lead.id}/intake-history`);

      expect(response.status()).toBe(status);
    });
  }

  test("the record, branch, and author of an inquiry come from the server (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const lead = await createLeadViaApi(reception, { fullName: `Lead ${testTag}`, phone: uniquePhone() });
    const other = await createLeadViaApi(reception, { fullName: `Lead hai ${testTag}`, phone: uniquePhone() });
    const adminId = (await (await (await apiAs("ADMIN")).get("/api/v1/me")).json()).id;

    const response = await reception.post(`/api/v1/persons/${lead.id}/inquiries`, {
      data: {
        channelId: await leadChannelId(reception, "Zalo"),
        personId: other.id,
        branchId: randomUUID(),
        createdById: adminId,
        id: randomUUID(),
        stage: "CUSTOMER",
        status: "CONTRACTED",
      },
    });

    expect(response.status()).toBe(201);
    const result = (await response.json()) as { personId: string; stage: string; inquiry: { by: { id: string } } };
    expect(result).toMatchObject({ personId: lead.id, stage: "LEAD" });
    expect(result.inquiry.by.id).not.toBe(adminId);
    const history = (await (await reception.get(`/api/v1/persons/${other.id}/intake-history`)).json()) as {
      items: unknown[];
    };
    expect(history.items).toEqual([]);
  });

  test("a missing channel, Khác without a note, control characters are 400; unknown or malformed ids are 404", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const lead = await createLeadViaApi(reception, { fullName: `Lead ${testTag}`, phone: uniquePhone() });
    const post = (id: string, data: unknown) => reception.post(`/api/v1/persons/${id}/inquiries`, { data });
    const errors = async (data: unknown) => {
      const response = await post(lead.id, data);
      expect(response.status()).toBe(400);
      return (await response.json()).details.fieldErrors;
    };
    const zalo = await leadChannelId(reception, "Zalo");

    expect(await errors({})).toMatchObject({ channelId: ["required"] });
    expect(await errors({ channelId: await leadChannelId(reception, "Khác") })).toMatchObject({
      channelNote: ["otherNeedsNote"],
    });
    expect(await errors({ channelId: zalo, note: "a\u0007b" })).toMatchObject({ note: ["invalidCharacters"] });
    expect(await errors({ channelId: zalo, sourceId: zalo })).toMatchObject({ sourceId: ["invalidChoice"] });
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await post(id, { channelId: zalo })).status()).toBe(404);
      expect((await reception.get(`/api/v1/persons/${id}/intake-history`)).status()).toBe(404);
    }
  });

  test("an inquiry on a customer is recorded without a lead journey", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    const response = await reception.post(`/api/v1/persons/${customer.id}/inquiries`, {
      data: { channelId: await leadChannelId(reception, "Zalo"), note: "Hỏi gia hạn" },
    });

    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({
      personId: customer.id,
      stage: "CUSTOMER",
      code: customer.customerCode,
      reopened: false,
    });
    expect((await reception.get(`/api/v1/leads/${customer.id}`)).status()).toBe(404);
  });
});

test.describe("A01 the re-care list (FR-LEAD-007)", () => {
  const viewers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of viewers) {
    test(`${role} reading the re-care list gets ${status} (lead.view)`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/leads/recare")).status()).toBe(status);
    });
  }

  test("bad filters are 400 with field errors", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const errors = async (query: string) => {
      const response = await manager.get(`/api/v1/leads/recare?${query}`);
      expect(response.status(), query).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors("status=CONSULTING")).toMatchObject({ status: ["invalidChoice"] });
    expect(await errors("scope=everyone")).toMatchObject({ scope: ["invalidChoice"] });
    expect(await errors("picUserId=x")).toMatchObject({ picUserId: ["invalidChoice"] });
    expect((await manager.get("/api/v1/leads/recare?pageSize=0")).status()).toBe(400);
    expect((await manager.get("/api/v1/leads/recare?page=-1")).status()).toBe(400);
  });

  test("a role with the lead permissions but not lead.merge, contact data hidden, and no customer.view (one sign-in, D-017, D-019)", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const phone = uniquePhone();
    const lead = await leadInRecareViaApi(
      { reception, consultant: await apiAs("CONSULTING") },
      { fullName: `Tái chăm sóc ${testTag}`, status: "NO_RESPONSE", phone },
    );
    const api = await userWithRole(apiAs, apiSignedIn, testTag, {
      // No lead.receive or lead.assign (the user would join the shared branch's round-robin and
      // its managers' notifications, and other specs' leads would notify them while the test
      // deletes them) and no customer.view.
      permissions: ["lead.view", "lead.create", "lead.manage"],
      fieldMasks: ["customer.phone", "customer.email"],
    });

    const list = await api.get("/api/v1/leads/recare?scope=all");
    expect(list.status()).toBe(200);
    const raw = await list.text();
    const row = (
      JSON.parse(raw) as { items: { id: string; phone: string | null; maskedFields: string[] }[] }
    ).items.find((item) => item.id === lead.id);
    expect(row).toMatchObject({ phone: null, maskedFields: ["phone"] });
    expect(raw).not.toContain(phone);
    const duplicate = await api.post("/api/v1/leads", {
      data: { fullName: `Trùng ${testTag}`, phone, channelId: await leadChannelId(reception, "Zalo") },
    });
    expect(duplicate.status()).toBe(409);
    const body = await duplicate.text();
    expect(JSON.parse(body)).toMatchObject({ code: "DUPLICATE_PHONE", details: { duplicate: { id: lead.id } } });
    // The answer names the record, never its contact data.
    expect(Object.keys(JSON.parse(body).details.duplicate).sort()).toEqual(["code", "fullName", "id", "stage"]);

    // Without lead.merge, merging is refused.
    const { first, second } = await twoLeads(apiAs, testTag);
    const merge = await api.post(`/api/v1/persons/${first.id}/merge`, {
      data: await mergeBody(await apiAs("ADMIN"), second.id),
    });
    expect(merge.status()).toBe(403);

    // Without customer.view a customer's phone is not answered with the customer (D-019).
    const customerPhone = uniquePhone();
    await createCustomerViaApi(reception, testTag, customerPhone);
    const hidden = await api.post("/api/v1/leads", {
      data: {
        fullName: `Trùng hai ${testTag}`,
        phone: customerPhone,
        channelId: await leadChannelId(reception, "Zalo"),
      },
    });
    expect(hidden.status()).toBe(409);
    const hiddenBody = await hidden.json();
    expect(hiddenBody.code).toBe("DUPLICATE_PHONE");
    expect(hiddenBody.details).not.toHaveProperty("duplicate");
  });
});

test.describe("A01 the intake route (D-019)", () => {
  for (const path of ["/api/v1/leads/intake", "/api/v1/leads"]) {
    test(`POST ${path} answers a repeated phone with DUPLICATE_PHONE and creates nobody`, async ({
      apiAs,
      testTag,
    }) => {
      const reception = await apiAs("RECEPTIONIST");
      const phone = uniquePhone();
      const first = await createLeadViaApi(reception, { fullName: `Lead ${testTag}`, phone });

      const response = await reception.post(path, {
        data: { fullName: `Lead hai ${testTag}`, phone, channelId: await leadChannelId(reception, "Zalo") },
      });

      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "DUPLICATE_PHONE",
        details: { duplicate: { id: first.id, stage: "LEAD", code: first.leadCode, fullName: first.fullName } },
      });
      const list = (await (await reception.get(`/api/v1/leads?q=${testTag}`)).json()) as { total: number };
      expect(list.total).toBe(1);
    });
  }

  test("PT and Kế toán cannot use the intake route", async ({ apiAs, testTag }) => {
    for (const role of ["PT", "ACCOUNTANT"] as const) {
      const response = await (
        await apiAs(role)
      ).post("/api/v1/leads/intake", {
        data: { fullName: `Lead ${testTag}`, channelId: randomUUID() },
      });
      expect(response.status(), role).toBe(403);
    }
  });
});
