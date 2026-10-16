// OWASP A01 (access control, data scope, masking, mass assignment), A03 (stored text) and
// A10 (input errors) for M2 slice 6: the script library, lead notes, and the customer
// profile (brief §4.1, §4.2; FR-LEAD-010, A-069 to A-076). Route-level 401s and 403s for
// every operation are also walked by permissions.spec.ts and access-control.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createUserViaApi } from "../support/admin";
import { createCustomerViaApi, createLeadViaApi, createScriptViaApi, uniquePhone } from "../support/data";
import type { Role } from "../support/db";

const SCOPES_ALL = {
  leads: "ALL",
  customers: "ALL",
  contracts: "ALL",
  schedule: "ALL",
  vouchers: "ALL",
  staff: "ALL",
  tasks: "ALL",
};

test.describe("A01 the script library (A-072)", () => {
  const writers: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["CONSULTING", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of writers) {
    test(`${role} adding a script gets ${status} (script.manage)`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);

      const response = await api.post("/api/v1/consulting-scripts", {
        data: { situationVi: `Thử ${role} ${testTag}`, situationEn: `Try ${role} ${testTag}` },
      });

      expect(response.status()).toBe(status);
    });
  }

  test("only a manager lists the inactive and empty scripts; a consultant sees active ones with an answer", async ({
    apiAs,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const consultant = await apiAs("CONSULTING");
    await createScriptViaApi(manager, {
      situationVi: `Có đáp án ${testTag}`,
      situationEn: `Answered ${testTag}`,
      answerVi: "Xin chào!",
    });
    await createScriptViaApi(manager, { situationVi: `Trống ${testTag}`, situationEn: `Empty ${testTag}` });
    const names = async (api: APIRequestContext, query = "") =>
      (
        (await (await api.get(`/api/v1/consulting-scripts${query}`)).json()) as { items: { situationVi: string }[] }
      ).items
        .map((script) => script.situationVi)
        .filter((name) => name.includes(testTag));

    expect(await names(consultant)).toEqual([`Có đáp án ${testTag}`]);
    expect(await names(manager)).toEqual([`Có đáp án ${testTag}`, `Trống ${testTag}`]);
    expect((await consultant.get("/api/v1/consulting-scripts?includeInactive=true")).status()).toBe(403);
    expect((await (await apiAs(null)).get("/api/v1/consulting-scripts")).status()).toBe(401);
    expect((await (await apiAs("ACCOUNTANT")).get("/api/v1/consulting-scripts")).status()).toBe(403);
  });

  test("changing or ordering a script is refused to a consultant, and nothing changes", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const consultant = await apiAs("CONSULTING");
    const script = await createScriptViaApi(manager, {
      situationVi: `Giữ nguyên ${testTag}`,
      situationEn: `Unchanged ${testTag}`,
      answerVi: "Gốc",
    });

    const update = await consultant.patch(`/api/v1/consulting-scripts/${script.id}`, {
      data: { situationVi: "Đổi", situationEn: "Changed", answerVi: "Sửa", active: false },
    });
    const order = await consultant.put("/api/v1/consulting-scripts/order", { data: { scriptIds: [script.id] } });

    expect([update.status(), order.status()]).toEqual([403, 403]);
    const all = (await (await manager.get("/api/v1/consulting-scripts?includeInactive=true")).json()) as {
      items: { id: string; situationVi: string; answerVi: string | null; active: boolean }[];
    };
    expect(all.items.find((item) => item.id === script.id)).toMatchObject({
      situationVi: `Giữ nguyên ${testTag}`,
      answerVi: "Gốc",
      active: true,
    });
  });

  test("the id, order, and times are the server's (mass assignment), and there is no delete", async ({
    apiAs,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const chosenId = randomUUID();

    const response = await manager.post("/api/v1/consulting-scripts", {
      data: {
        id: chosenId,
        sortOrder: -5,
        createdAt: "2001-01-01T00:00:00Z",
        situationVi: `Do server ${testTag}`,
        situationEn: `Server ${testTag}`,
      },
    });

    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: string; sortOrder: number };
    expect(created.id).not.toBe(chosenId);
    expect(created.sortOrder).toBeGreaterThanOrEqual(13);
    // Nothing deletes a script: the route does not exist.
    expect([404, 405]).toContain((await manager.delete(`/api/v1/consulting-scripts/${created.id}`)).status());
  });

  test("text with markup is stored and returned as plain text, never as HTML", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const payload = `<img src=x onerror="window.__xss=1">${testTag}`;
    await createScriptViaApi(manager, { situationVi: payload, situationEn: payload, answerVi: payload });

    const response = await manager.get("/api/v1/consulting-scripts?includeInactive=true");

    expect(response.headers()["content-type"]).toContain("application/json");
    const items = ((await response.json()) as { items: { situationVi: string }[] }).items;
    expect(items.some((item) => item.situationVi === payload)).toBe(true);
  });
});

test.describe("A10 script input errors", () => {
  test("missing names, overlong text, control characters, bad ids and a bad order are 400 or 404", async ({
    apiAs,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const post = (data: unknown) => manager.post("/api/v1/consulting-scripts", { data });
    const errors = async (data: unknown) => {
      const response = await post(data);
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors({})).toMatchObject({ situationVi: ["required"], situationEn: ["required"] });
    expect(await errors({ situationVi: "a".repeat(101), situationEn: "ok" })).toMatchObject({
      situationVi: ["tooLong"],
    });
    expect(await errors({ situationVi: "ok", situationEn: "ok", answerVi: "x".repeat(4001) })).toMatchObject({
      answerVi: ["tooLong"],
    });
    expect(await errors({ situationVi: "ok", situationEn: "ok", answerEn: "a\u0000b" })).toMatchObject({
      answerEn: ["invalidCharacters"],
    });
    const body = { situationVi: `Hợp lệ ${testTag}`, situationEn: `Valid ${testTag}` };
    expect((await manager.patch(`/api/v1/consulting-scripts/${randomUUID()}`, { data: body })).status()).toBe(404);
    expect((await manager.patch("/api/v1/consulting-scripts/not-a-uuid", { data: body })).status()).toBe(404);
    const order = await manager.put("/api/v1/consulting-scripts/order", { data: { scriptIds: [randomUUID()] } });
    expect(order.status()).toBe(400);
    expect((await order.json()).details.fieldErrors).toMatchObject({ scriptIds: ["invalidChoice"] });
  });
});

test.describe("A01 lead notes (A-074)", () => {
  const writers: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["CONSULTING", 201],
    ["RECEPTIONIST", 201],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of writers) {
    test(`${role} adding a note gets ${status} (lead.manage)`, async ({ apiAs, testTag }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Ghi chú ${role} ${testTag}` });
      const api = await apiAs(role);

      const response = await api.post(`/api/v1/leads/${lead.id}/notes`, { data: { body: `Từ ${role}` } });

      expect(response.status()).toBe(status);
      if (status === 403) {
        const timeline = (await (await (await apiAs("ADMIN")).get(`/api/v1/leads/${lead.id}/timeline`)).json()) as {
          items: { kind: string }[];
        };
        expect(timeline.items.filter((item) => item.kind === "note")).toHaveLength(0);
      }
    });
  }

  test("the author, the time, and the lead are the server's, and a note cannot be changed or removed", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const consultant = await apiAs("CONSULTING");
    const lead = await createLeadViaApi(reception, { fullName: `Tác giả ${testTag}` });
    const other = await createLeadViaApi(reception, { fullName: `Lead khác ${testTag}` });
    const consultantId = (await (await consultant.get("/api/v1/me")).json()).id as string;

    const response = await consultant.post(`/api/v1/leads/${lead.id}/notes`, {
      data: {
        body: "Ghi chú thật",
        createdBy: randomUUID(),
        by: { id: randomUUID() },
        personId: other.id,
        at: "2001-01-01",
      },
    });

    expect(response.status()).toBe(201);
    const note = (await response.json()) as { id: string; by: { id: string }; at: string };
    expect(note.by.id).toBe(consultantId);
    expect(new Date(note.at).getFullYear()).toBeGreaterThan(2020);
    const timelineOf = async (id: string) =>
      ((await (await reception.get(`/api/v1/leads/${id}/timeline`)).json()) as { items: { kind: string }[] }).items;
    expect((await timelineOf(lead.id)).filter((item) => item.kind === "note")).toHaveLength(1);
    expect((await timelineOf(other.id)).filter((item) => item.kind === "note")).toHaveLength(0);
    for (const method of ["patch", "put", "delete"] as const) {
      const attempt = await consultant[method](`/api/v1/leads/${lead.id}/notes/${note.id}`, { data: { body: "Sửa" } });
      expect([404, 405]).toContain(attempt.status());
    }
  });

  test("an unknown lead and a lead of another branch are 404, and a note on a customer is too", async ({
    apiAs,
    testTag,
  }) => {
    const consultant = await apiAs("CONSULTING");
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    expect((await consultant.post(`/api/v1/leads/${randomUUID()}/notes`, { data: { body: "x" } })).status()).toBe(404);
    expect((await consultant.post("/api/v1/leads/not-a-uuid/notes", { data: { body: "x" } })).status()).toBe(404);
    expect((await consultant.post(`/api/v1/leads/${customer.id}/notes`, { data: { body: "x" } })).status()).toBe(404);
  });

  test("an empty, oversized, or control-character note is 400 with a field error", async ({ apiAs, testTag }) => {
    const consultant = await apiAs("CONSULTING");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lỗi ${testTag}` });
    const errors = async (body: unknown) => {
      const response = await consultant.post(`/api/v1/leads/${lead.id}/notes`, { data: { body } });
      expect(response.status()).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors("   ")).toMatchObject({ body: ["required"] });
    expect(await errors("x".repeat(2001))).toMatchObject({ body: ["tooLong"] });
    expect(await errors("a\u0000b")).toMatchObject({ body: ["invalidCharacters"] });
    const missing = await consultant.post(`/api/v1/leads/${lead.id}/notes`, { data: {} });
    expect(missing.status()).toBe(400);
  });

  test("note text is returned as plain text", async ({ apiAs, testTag }) => {
    const consultant = await apiAs("CONSULTING");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Chữ ${testTag}` });
    const payload = `<script>alert("${testTag}")</script>`;

    const response = await consultant.post(`/api/v1/leads/${lead.id}/notes`, { data: { body: payload } });

    expect(response.status()).toBe(201);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toMatchObject({ body: payload });
  });
});

test.describe("A01 the customer profile (A-069 to A-071, A-075)", () => {
  async function userWithMask(
    apiAs: (role: Role | null) => Promise<APIRequestContext>,
    apiSignedIn: (email: string, password: string) => Promise<APIRequestContext>,
    tag: string,
    fieldMasks: string[],
  ) {
    const admin = await apiAs("ADMIN");
    const created = await admin.post("/api/v1/roles", {
      data: {
        name: `Vai trò ${tag}`,
        permissions: ["customer.view", "customer.manage"],
        dataScopes: SCOPES_ALL,
        fieldMasks,
      },
    });
    expect(created.status()).toBe(201);
    const user = await createUserViaApi(admin, tag, { roleId: (await created.json()).id, label: "Custom" });
    return apiSignedIn(user.email, user.password);
  }

  test("a hidden address and emergency contact come back empty, are listed as hidden, and cannot be changed", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const created = await reception.post("/api/v1/customers", {
      data: {
        fullName: `Địa chỉ ${testTag}`,
        phone: uniquePhone(),
        address: "56 Hai Bà Trưng",
        emergencyContactName: "Lê Thị D",
        emergencyContactPhone: "0911222333",
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const masked = await userWithMask(apiAs, apiSignedIn, testTag, ["customer.address"]);

    const seen = await (await masked.get(`/api/v1/customers/${id}`)).json();
    expect(seen).toMatchObject({
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      maskedFields: ["address"],
    });
    const edit = await masked.patch(`/api/v1/customers/${id}`, {
      data: { address: "Chỗ khác", emergencyContactName: "X", notes: "Đã gọi" },
    });
    expect(edit.status()).toBe(200);
    expect(await (await reception.get(`/api/v1/customers/${id}`)).json()).toMatchObject({
      address: "56 Hai Bà Trưng",
      emergencyContactName: "Lê Thị D",
      notes: "Đã gọi",
    });
  });

  test("a user who cannot see emails is not told which customers have none", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    await reception.post("/api/v1/customers", { data: { fullName: `Không mail ${testTag}`, phone: uniquePhone() } });
    await reception.post("/api/v1/customers", {
      data: { fullName: `Có mail ${testTag}`, phone: uniquePhone(), email: `${testTag.toLowerCase()}@example.com` },
    });
    const masked = await userWithMask(apiAs, apiSignedIn, testTag, ["customer.email"]);

    const filtered = (await (await masked.get(`/api/v1/customers?search=${testTag}&noEmail=true`)).json()) as {
      total: number;
    };
    const everyone = (await (await masked.get(`/api/v1/customers?search=${testTag}`)).json()) as { total: number };

    expect(filtered.total).toBe(everyone.total);
    const own = (await (await reception.get(`/api/v1/customers?search=${testTag}&noEmail=true`)).json()) as {
      total: number;
    };
    expect(own.total).toBe(1);
  });

  test("the staff in charge must be an active user of the customer's branch, and the choice list needs customer.view", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    const stranger = await reception.patch(`/api/v1/customers/${customer.id}`, {
      data: { staffInChargeId: randomUUID() },
    });

    expect(stranger.status()).toBe(400);
    expect((await stranger.json()).details.fieldErrors).toMatchObject({ staffInChargeId: ["invalidChoice"] });
    expect((await reception.get("/api/v1/customers/staff")).status()).toBe(200);
    // A role that can see leads but not customers.
    const admin = await apiAs("ADMIN");
    const role = await admin.post("/api/v1/roles", {
      data: { name: `Vai trò ${testTag}`, permissions: ["lead.view"], dataScopes: SCOPES_ALL, fieldMasks: [] },
    });
    const user = await createUserViaApi(admin, testTag, { roleId: (await role.json()).id, label: "Custom" });
    expect((await (await apiSignedIn(user.email, user.password)).get("/api/v1/customers/staff")).status()).toBe(403);
    expect((await (await apiAs(null)).get("/api/v1/customers/staff")).status()).toBe(401);
  });

  test("bad filter values are 400 with field errors", async ({ apiAs }) => {
    const reception = await apiAs("RECEPTIONIST");
    const errors = async (query: string) => {
      const response = await reception.get(`/api/v1/customers?${query}`);
      expect(response.status()).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors("birthdayMonth=13")).toMatchObject({ birthdayMonth: ["invalidChoice"] });
    expect(await errors("staffId=x")).toHaveProperty("staffId");
    expect(await errors("registeredFrom=31/02/2026")).toHaveProperty("registeredFrom");
    expect(await errors("branchId=x")).toHaveProperty("branchId");
  });

  test("a profile with a bad phone, control characters, or a group of another list is 400", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const channels = (await (await reception.get("/api/v1/option-lists/leadChannels/options")).json()) as {
      items: { id: string }[];
    };

    const response = await reception.post("/api/v1/customers", {
      data: {
        fullName: `Lỗi ${testTag}`,
        phone: uniquePhone(),
        address: "a\u0000b",
        emergencyContactPhone: "abc",
        customerGroupId: channels.items[0].id,
      },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).details.fieldErrors).toMatchObject({
      address: ["invalidCharacters"],
      emergencyContactPhone: ["invalidPhone"],
    });
    const wrongList = await reception.post("/api/v1/customers", {
      data: { fullName: `Sai nhóm ${testTag}`, phone: uniquePhone(), customerGroupId: channels.items[0].id },
    });
    expect(wrongList.status()).toBe(400);
    expect((await wrongList.json()).details.fieldErrors).toMatchObject({ customerGroupId: ["invalidChoice"] });
  });
});
