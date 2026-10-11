// OWASP A01 (access control, data scope, mass assignment) and A10 (input errors) for
// the lead routes of M2 slices 1 and 2 (brief §4.1, D-019, D-020). Route-level 401s
// and 403s are covered by the route inventory in access-control.spec.ts; tests that need
// consultants of their own are in leads.branch.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createLeadViaApi } from "../support/data";
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
