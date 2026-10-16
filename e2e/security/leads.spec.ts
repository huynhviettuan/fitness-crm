// OWASP A01 (access control, data scope, mass assignment) and A10 (input errors) for
// the lead routes of M2 slices 1 and 2 (brief §4.1, D-019, D-020). Route-level 401s
// and 403s are covered by the route inventory in access-control.spec.ts; tests that need
// consultants of their own are in leads.branch.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createLeadViaApi, uniquePhone } from "../support/data";
import type { Role } from "../support/db";

async function whatsApp(api: APIRequestContext): Promise<string> {
  const options = (await (await api.get("/api/v1/option-lists/leadChannels/options")).json()) as {
    items: { id: string; labelVi: string }[];
  };
  return options.items.find((option) => option.labelVi === "WhatsApp")!.id;
}

test.describe("A01 leads", () => {
  const expectations: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["CONSULTING", 201],
    ["RECEPTIONIST", 201],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of expectations) {
    test(`${role} adding a lead gets ${status} (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/leads", {
        data: { fullName: `Lead ${testTag}`, channelId: await whatsApp(await apiAs("ADMIN")) },
      });
      expect(response.status()).toBe(status);
    });
  }

  test("the code, stage, status, person in charge, and customer code cannot be set by the client (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const admin = await apiAs("ADMIN");
    const adminId = (await (await admin.get("/api/v1/me")).json()).id;

    const response = await reception.post("/api/v1/leads", {
      data: {
        fullName: `Lead ${testTag}`,
        channelId: await whatsApp(reception),
        leadCode: "LD999999",
        customerCode: "KH999999",
        stage: "CUSTOMER",
        status: "CONTRACTED",
        leadStatus: "CONTRACTED",
        picUserId: adminId,
        id: randomUUID(),
      },
    });

    expect(response.status()).toBe(201);
    // The round-robin decides the person in charge (BR-203), and with it Consulting.
    const lead = await response.json();
    expect(lead).toMatchObject({ stage: "LEAD", status: "CONSULTING", customerCode: null });
    expect(lead.pic?.id).not.toBe(adminId);
    expect(lead.leadCode).not.toBe("LD999999");
  });
});

test.describe("A01 lead journey (D-020)", () => {
  const changers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of changers) {
    test(`${role} changing a lead's status gets ${status} (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      // In the shared branch the lead goes to the E2E consultant, so everyone who works leads sees it.
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
      const response = await (
        await apiAs(role)
      ).post(`/api/v1/leads/${lead.id}/status`, { data: { status: "CONSIDERING" } });
      expect(response.status()).toBe(status);
    });
  }

  const assigners: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of assigners) {
    test(`${role} reassigning a lead gets ${status} (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
      const api = await apiAs(role);
      expect((await api.post(`/api/v1/leads/${lead.id}/assign`, { data: { userId: lead.pic?.id } })).status()).toBe(
        status,
      );
      expect((await api.get(`/api/v1/leads/${lead.id}/assignees`)).status()).toBe(status);
    });
  }

  test("the person in charge, status time, and re-care date of a status change come from the server (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const adminId = (await (await admin.get("/api/v1/me")).json()).id;
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });

    const response = await admin.post(`/api/v1/leads/${lead.id}/status`, {
      data: {
        status: "CONSIDERING",
        picUserId: adminId,
        leadStatus: "CONTRACTED",
        contactAgainOn: "2030-01-01",
        statusChangedAt: "2020-01-01T00:00:00Z",
      },
    });

    expect(response.status()).toBe(200);
    const changed = await response.json();
    expect(changed).toMatchObject({ status: "CONSIDERING", pic: { id: lead.pic?.id }, contactAgainOn: null });
    expect(new Date(changed.statusChangedAt).getFullYear()).toBeGreaterThan(2020);
  });

  test("a lead goes only to someone of its branch who receives leads", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
    const receptionId = (await (await (await apiAs("RECEPTIONIST")).get("/api/v1/me")).json()).id;

    const response = await manager.post(`/api/v1/leads/${lead.id}/assign`, { data: { userId: receptionId } });
    expect(response.status()).toBe(400);
    expect((await response.json()).details.fieldErrors).toEqual({ userId: ["invalidChoice"] });
  });
});

/** A lead's open step, by its key in checklist version 1. */
async function stepOf(api: APIRequestContext, leadId: string, key: string): Promise<{ id: string; state: string }> {
  const { items } = (await (await api.get(`/api/v1/leads/${leadId}/steps`)).json()) as {
    items: { id: string; key: string; state: string }[];
  };
  return items.find((item) => item.key === key)!;
}

test.describe("A01 consulting checklist (D-020, FR-LEAD-004)", () => {
  const readers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 403],
    ["CONSULTING", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of readers) {
    test(`${role} reading the checklist's configuration gets ${status} (config.manage)`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/consulting-checklist")).status()).toBe(status);
    });
  }

  test("only config.manage saves a new version", async ({ apiAs }) => {
    const steps = (
      (await (await (await apiAs("ADMIN")).get("/api/v1/consulting-checklist")).json()) as { steps: unknown[] }
    ).steps;
    const response = await (await apiAs("FITNESS_MANAGER")).post("/api/v1/consulting-checklist", { data: { steps } });
    expect(response.status()).toBe(403);
  });

  const completers: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of completers) {
    test(`${role} completing a step gets ${status} (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      // The lead goes to the E2E consultant, so its first step is open.
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
      const step = await stepOf(await apiAs("ADMIN"), lead.id, "tu-van");
      const response = await (
        await apiAs(role)
      ).post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, { data: { resultIndex: 0 } });
      expect(response.status()).toBe(status);
    });
  }

  test("who did a step, when, and whether on time come from the server (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
    const admin = await apiAs("ADMIN");
    const adminId = (await (await admin.get("/api/v1/me")).json()).id;
    const step = await stepOf(admin, lead.id, "tu-van");

    const response = await (
      await apiAs("CONSULTING")
    ).post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, {
      data: { resultIndex: 0, doneById: adminId, doneAt: "2020-01-01T00:00:00Z", timing: "LATE", state: "WAITING" },
    });

    expect(response.status()).toBe(200);
    const done = (
      (await response.json()) as { items: { id: string; doneBy: { id: string }; doneAt: string; timing: string }[] }
    ).items.find((item) => item.id === step.id)!;
    expect(done.doneBy.id).not.toBe(adminId);
    expect(done.timing).toBe("ON_TIME");
    expect(new Date(done.doneAt).getFullYear()).toBeGreaterThan(2020);
  });
});

const SHOW = {
  idDocumentType: "CCCD",
  idDocumentNumber: "079201001234",
  birthDate: "15/03/1990",
  countryCode: "VN",
  email: "khach@example.com",
  consent: true,
};

/** A lead booked for a visit, in the E2E consultant's charge. */
async function bookedLead(apiAs: (role: Role) => Promise<APIRequestContext>, name: string) {
  const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: name });
  await (
    await apiAs("CONSULTING")
  ).post(`/api/v1/leads/${lead.id}/status`, {
    data: { status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:30" },
  });
  return lead;
}

test.describe("A01 Show and No show (D-019, D-042)", () => {
  const recorders: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["CONSULTING", 200],
    ["RECEPTIONIST", 200],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of recorders) {
    test(`${role} recording Show gets ${status} (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      const lead = await bookedLead(apiAs, `Lead ${testTag}`);
      const response = await (
        await apiAs(role)
      ).post(`/api/v1/leads/${lead.id}/show`, { data: { ...SHOW, phone: uniquePhone() } });
      expect(response.status()).toBe(status);
    });
  }

  test("the customer code, stage, and consent time come from the server (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const lead = await bookedLead(apiAs, `Lead ${testTag}`);
    const reception = await apiAs("RECEPTIONIST");

    const response = await reception.post(`/api/v1/leads/${lead.id}/show`, {
      data: {
        ...SHOW,
        phone: uniquePhone(),
        customerCode: "KH999999",
        stage: "LEAD",
        dataConsentAt: "2020-01-01T00:00:00Z",
        branchId: randomUUID(),
      },
    });

    expect(response.status()).toBe(200);
    const customer = (await (await reception.get(`/api/v1/customers/${lead.id}`)).json()) as {
      customerCode: string;
      dataConsentAt: string;
    };
    expect(customer.customerCode).not.toBe("KH999999");
    expect(new Date(customer.dataConsentAt).getFullYear()).toBeGreaterThan(2020);
  });

  test("a role with the ID document and health note hidden never receives them (D-042)", async ({ apiAs, testTag }) => {
    const lead = await bookedLead(apiAs, `Lead ${testTag}`);
    await (
      await apiAs("RECEPTIONIST")
    ).post(`/api/v1/leads/${lead.id}/show`, {
      data: { ...SHOW, phone: uniquePhone(), healthNote: "Đau gối" },
    });

    // Kế toán sees customers, with ID documents and health notes hidden (A-060).
    const accountant = await (await apiAs("ACCOUNTANT")).get(`/api/v1/customers/${lead.id}`);
    expect(accountant.status()).toBe(200);
    const body = await accountant.text();
    expect(body).not.toContain("079201001234");
    expect(body).not.toContain("Đau gối");
    expect(JSON.parse(body)).toMatchObject({ idDocumentType: "CCCD", idDocumentNumber: null, healthNote: null });
  });
});

test.describe("A10 consulting step input errors", () => {
  test("a result outside the step's list is 400; a waiting or done step is 409; another lead's step is 404", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");
    const lead = await createLeadViaApi(reception, { fullName: `Lead ${testTag}` });
    const other = await createLeadViaApi(reception, { fullName: `Lead 2 ${testTag}` });
    const open = await stepOf(manager, lead.id, "tu-van");
    const waiting = await stepOf(manager, lead.id, "nhac-1");
    const complete = (leadId: string, stepId: string, data: unknown) =>
      manager.post(`/api/v1/leads/${leadId}/steps/${stepId}/complete`, { data });

    const outside = await complete(lead.id, open.id, { resultIndex: 5 });
    expect(outside.status()).toBe(400);
    expect((await outside.json()).details.fieldErrors).toEqual({ resultIndex: ["invalidChoice"] });
    const malformed = await complete(lead.id, open.id, { resultIndex: "x", note: "a\u0000b" });
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).details.fieldErrors).toMatchObject({
      resultIndex: ["required"],
      note: ["invalidCharacters"],
    });
    expect((await complete(lead.id, waiting.id, { resultIndex: 0 })).status()).toBe(409);
    expect((await complete(other.id, open.id, { resultIndex: 0 })).status()).toBe(404);
    expect((await complete(lead.id, "not-a-uuid", { resultIndex: 0 })).status()).toBe(404);
    expect((await complete(lead.id, open.id, { resultIndex: 0 })).status()).toBe(200);
    expect((await complete(lead.id, open.id, { resultIndex: 0 })).status()).toBe(409);
    expect((await manager.get("/api/v1/leads/today?scope=team")).status()).toBe(400);
  });

  test("Show needs every detail and the consent; No show needs an appointment; a lead converts once", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const lead = await bookedLead(apiAs, `Lead ${testTag}`);
    const show = (data: unknown) => reception.post(`/api/v1/leads/${lead.id}/show`, { data });

    const missing = await show({});
    expect(missing.status()).toBe(400);
    expect((await missing.json()).details.fieldErrors).toMatchObject({
      consent: ["consentRequired"],
      idDocumentType: ["invalidChoice"],
    });
    const noConsent = await show({ ...SHOW, phone: uniquePhone(), consent: false });
    expect(noConsent.status()).toBe(400);
    expect((await noConsent.json()).details.fieldErrors).toEqual({ consent: ["consentRequired"] });
    const wrongNumber = await show({ ...SHOW, phone: uniquePhone(), idDocumentNumber: "12345" });
    expect(wrongNumber.status()).toBe(400);
    expect((await wrongNumber.json()).details.fieldErrors).toEqual({ idDocumentNumber: ["invalidIdDocument"] });

    const walkIn = await createLeadViaApi(reception, { fullName: `Lead 2 ${testTag}` });
    const notBooked = await reception.post(`/api/v1/leads/${walkIn.id}/no-show`);
    expect(notBooked.status()).toBe(409);
    expect((await notBooked.json()).code).toBe("INVALID_STATUS_TRANSITION");

    expect((await show({ ...SHOW, phone: uniquePhone() })).status()).toBe(200);
    // A customer now, no longer a lead.
    expect((await show({ ...SHOW, phone: uniquePhone() })).status()).toBe(404);
    expect((await reception.post(`/api/v1/leads/${lead.id}/no-show`)).status()).toBe(404);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect(
        (await reception.post(`/api/v1/leads/${id}/show`, { data: { ...SHOW, phone: uniquePhone() } })).status(),
      ).toBe(404);
    }
  });

  test("a checklist that waits on a missing step, or repeats a key, is 400", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    const response = await admin.post("/api/v1/consulting-checklist", {
      data: {
        steps: [
          {
            key: "a",
            labelVi: "A",
            labelEn: "A",
            trigger: "AFTER_STEP",
            triggerStepKey: "b",
            offsetValue: 0,
            offsetUnit: "MINUTES",
            results: [{ labelVi: "Done", labelEn: "Done" }],
          },
          {
            key: "a",
            labelVi: "B",
            labelEn: "B",
            trigger: "ASSIGNED",
            offsetValue: 1000,
            offsetUnit: "WEEKS",
            results: [],
          },
        ],
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).details.fieldErrors).toHaveProperty("steps");
  });
});

test.describe("A10 lead input errors", () => {
  test("invalid fields are 400 with field errors; unknown or malformed ids are 404", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    const invalid = await manager.post("/api/v1/leads", {
      data: {
        fullName: "",
        channelId: "x",
        phone: "12",
        email: "a@",
        sourceType: "FREE",
        birthDate: "31/02/2000",
        sourceId: randomUUID(),
      },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).details.fieldErrors).toMatchObject({
      fullName: ["required"],
      channelId: ["required"],
      phone: ["invalidPhone"],
      email: ["invalidEmail"],
      sourceType: ["invalidChoice"],
      birthDate: ["invalidDate"],
    });
    const wrongList = await manager.post("/api/v1/leads", {
      data: { fullName: "A", channelId: await whatsApp(manager), sourceId: randomUUID() },
    });
    expect(wrongList.status()).toBe(400);
    expect((await wrongList.json()).details.fieldErrors).toMatchObject({ sourceId: ["invalidChoice"] });
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await manager.get(`/api/v1/leads/${id}`)).status()).toBe(404);
    }
    expect((await manager.get("/api/v1/leads?status=WON")).status()).toBe(400);
  });

  test("status changes and assignments check their input; a move the flow forbids is 409", async ({
    apiAs,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
    const post = (path: string, data: unknown) => manager.post(`/api/v1/leads/${lead.id}/${path}`, { data });
    const errors = async (path: string, data: unknown) => {
      const response = await post(path, data);
      expect(response.status()).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors("status", { status: "WON" })).toMatchObject({ status: ["invalidChoice"] });
    expect(await errors("status", { status: "SHOWED" })).toMatchObject({ status: ["invalidChoice"] });
    expect(
      await errors("status", { status: "BOOKED", appointmentDate: "31/02/2030", appointmentTime: "" }),
    ).toMatchObject({
      appointmentDate: ["invalidDate"],
      appointmentTime: ["required"],
    });
    expect(
      await errors("status", { status: "BOOKED", appointmentDate: "01/01/2020", appointmentTime: "09:00" }),
    ).toMatchObject({
      appointmentDate: ["notInFuture"],
    });
    expect(await errors("status", { status: "REFUSED", refuseReasonId: "" })).toMatchObject({
      refuseReasonId: ["required"],
    });
    expect(await errors("status", { status: "REFUSED", refuseReasonId: randomUUID() })).toMatchObject({
      refuseReasonId: ["invalidChoice"],
    });
    expect(await errors("status", { status: "CONSIDERING", note: "a\u0000b" })).toMatchObject({
      note: ["invalidCharacters"],
    });
    expect(await errors("assign", { userId: "x" })).toMatchObject({ userId: ["required"] });

    const again = await post("status", { status: "CONSULTING" });
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe("INVALID_STATUS_TRANSITION");
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await manager.post(`/api/v1/leads/${id}/status`, { data: { status: "CONSIDERING" } })).status()).toBe(
        404,
      );
      expect((await manager.get(`/api/v1/leads/${id}/timeline`)).status()).toBe(404);
    }
  });
});
