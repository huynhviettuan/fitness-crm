// OWASP A01 (access control, data scope, mass assignment) and A10 (input errors) for
// the lead routes of M2 slice 1 (brief §4.1, D-019). Route-level 401s and 403s are
// covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { uniquePhone } from "../support/data";
import type { Role } from "../support/db";

async function whatsApp(api: APIRequestContext): Promise<string> {
  const options = (await (await api.get("/api/v1/option-lists/leadChannels/options")).json()) as { items: { id: string; labelVi: string }[] };
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
      const response = await api.post("/api/v1/leads", { data: { fullName: `Lead ${testTag}`, channelId: await whatsApp(await apiAs("ADMIN")) } });
      expect(response.status()).toBe(status);
    });
  }

  test("a consultant cannot open another person's lead, and a lead is not reachable as a customer", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const lead = await (await reception.post("/api/v1/leads", { data: { fullName: `Lead ${testTag}`, channelId: await whatsApp(reception) } })).json();
    const consulting = await apiAs("CONSULTING");

    expect((await consulting.get(`/api/v1/leads/${lead.id}`)).status()).toBe(404);
    expect((await consulting.patch(`/api/v1/leads/${lead.id}`, { data: { fullName: "X", channelId: await whatsApp(reception) } })).status()).toBe(404);
    expect((await reception.get(`/api/v1/customers/${lead.id}`)).status()).toBe(404);
  });

  test("the code, stage, status, person in charge, and customer code cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
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
    expect(await response.json()).toMatchObject({ stage: "LEAD", status: "NEW", customerCode: null, pic: null });
  });

  test("a duplicate phone names the existing record only to someone who may see it (D-019)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const phone = uniquePhone();
    const first = await (await reception.post("/api/v1/leads", { data: { fullName: `Lead ${testTag}`, phone, channelId: await whatsApp(reception) } })).json();

    const again = await reception.post("/api/v1/leads", { data: { fullName: `Lead 2 ${testTag}`, phone, channelId: await whatsApp(reception) } });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: "PHONE_ALREADY_USED", details: { duplicate: { id: first.id, stage: "LEAD" } } });

    const consulting = await apiAs("CONSULTING");
    const hidden = await consulting.post("/api/v1/leads", { data: { fullName: `Lead 3 ${testTag}`, phone, channelId: await whatsApp(reception) } });
    expect(hidden.status()).toBe(409);
    expect((await hidden.json()).details).not.toHaveProperty("duplicate");
  });
});

test.describe("A10 lead input errors", () => {
  test("invalid fields are 400 with field errors; unknown or malformed ids are 404", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    const invalid = await manager.post("/api/v1/leads", {
      data: { fullName: "", channelId: "x", phone: "12", email: "a@", sourceType: "FREE", birthDate: "31/02/2000", sourceId: randomUUID() },
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
    const wrongList = await manager.post("/api/v1/leads", { data: { fullName: "A", channelId: await whatsApp(manager), sourceId: randomUUID() } });
    expect(wrongList.status()).toBe(400);
    expect((await wrongList.json()).details.fieldErrors).toMatchObject({ sourceId: ["invalidChoice"] });
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await manager.get(`/api/v1/leads/${id}`)).status()).toBe(404);
    }
    expect((await manager.get("/api/v1/leads?status=WON")).status()).toBe(400);
  });
});
