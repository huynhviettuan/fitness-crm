// OWASP A01 (access control, data scope, mass assignment) and A10 (input errors) for
// the employee and working-schedule routes of M1 slice 6 (brief §8.4, D-030). Route-
// level 401s and 403s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { BOOKING_DAY, createTrainerViaApi } from "../support/data";
import { E2E_TRAINER_NAME, type Role } from "../support/db";

test.describe("A01 employee roles (09_RBAC.md)", () => {
  const createExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
    ["CONSULTING", 403],
  ];
  for (const [role, status] of createExpectations) {
    test(`${role} adding an employee gets ${status}`, async ({ apiAs, testTag }) => {
      const response = await (await apiAs(role)).post("/api/v1/employees", { data: { fullName: `NV ${testTag}` } });
      expect(response.status()).toBe(status);
    });
  }

  test("a PT sees only their own profile and schedule, and changes neither (staff scope only mine)", async ({ apiAs, testTag }) => {
    const other = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), testTag);
    const pt = await apiAs("PT");

    const list = await (await pt.get("/api/v1/employees?pageSize=100")).json();
    expect(list.items.map((item: { fullName: string }) => item.fullName)).toEqual([E2E_TRAINER_NAME]);
    const own = list.items[0] as { id: string };
    expect((await pt.get(`/api/v1/employees/${own.id}/schedule`)).status()).toBe(200);
    for (const path of [`/api/v1/employees/${other.id}`, `/api/v1/employees/${other.id}/schedule`]) {
      expect((await pt.get(path)).status(), path).toBe(404);
    }
    expect((await pt.put(`/api/v1/employees/${own.id}/shifts`, { data: { shifts: [] } })).status()).toBe(403);
    expect((await pt.post(`/api/v1/employees/${own.id}/days-off`, { data: { date: BOOKING_DAY.date } })).status()).toBe(403);
    expect((await pt.patch(`/api/v1/employees/${own.id}`, { data: { fullName: "X" } })).status()).toBe(403);
  });

  test("the calendar's trainers are open to booking staff, and a PT gets only their own row", async ({ apiAs, testTag }) => {
    const trainer = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), testTag);
    const day = `/api/v1/schedule/trainers?date=${BOOKING_DAY.date}`;

    const forReception = await (await (await apiAs("RECEPTIONIST")).get(day)).json();
    expect(forReception.items.map((item: { trainer: { id: string } }) => item.trainer.id)).toContain(trainer.id);
    const forPt = await (await (await apiAs("PT")).get(day)).json();
    expect(forPt.items.map((item: { trainer: { fullName: string } }) => item.trainer.fullName)).toEqual([E2E_TRAINER_NAME]);
    expect((await (await apiAs("ACCOUNTANT")).get(day)).status()).toBe(200);
  });

  test("the code, the search name, and the record id cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const id = randomUUID();

    const created = await manager.post("/api/v1/employees", {
      data: { fullName: `NV ${testTag}`, employeeCode: "HACK001", searchName: "x", id },
    });

    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.employeeCode).toMatch(/^[A-Z]{1,5}\d{3,}$/);
    expect(body.employeeCode).not.toBe("HACK001");
    expect(body.id).not.toBe(id);
    const updated = await manager.patch(`/api/v1/employees/${body.id}`, { data: { fullName: `NV ${testTag}`, employeeCode: "HACK002" } });
    expect((await updated.json()).employeeCode).toBe(body.employeeCode);
  });

  test("a login that already belongs to an employee cannot be linked again", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { id: ptUserId } = await (await (await apiAs("PT")).get("/api/v1/me")).json();

    const response = await admin.post("/api/v1/employees", { data: { fullName: `NV ${testTag}`, userId: ptUserId } });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ details: { fieldErrors: { userId: ["userAlreadyLinked"] } } });
  });
});

test.describe("A10 employee input errors", () => {
  test("unknown or malformed ids are 404, and invalid fields, shifts, and days off are 400", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const trainer = await createTrainerViaApi(manager, testTag);

    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await manager.patch(`/api/v1/employees/${id}`, { data: { fullName: "X" } })).status()).toBe(404);
      expect((await manager.get(`/api/v1/employees/${id}/schedule`)).status()).toBe(404);
    }
    expect((await manager.delete(`/api/v1/employees/${trainer.id}/days-off/${randomUUID()}`)).status()).toBe(404);

    const invalid = await manager.patch(`/api/v1/employees/${trainer.id}`, { data: { fullName: "", status: "FIRED", gender: "X" } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).details.fieldErrors).toMatchObject({ fullName: ["required"], status: ["invalidChoice"], gender: ["invalidChoice"] });

    const overlapping = await manager.put(`/api/v1/employees/${trainer.id}/shifts`, {
      data: {
        shifts: [
          { weekday: 1, start: "08:00", end: "12:00" },
          { weekday: 1, start: "11:00", end: "13:00" },
        ],
      },
    });
    expect(overlapping.status()).toBe(400);
    expect((await overlapping.json()).details.fieldErrors).toMatchObject({ shifts: ["shiftsOverlap"] });
    expect((await manager.put(`/api/v1/employees/${trainer.id}/shifts`, { data: { shifts: [{ weekday: 9, start: "25:00", end: "x" }] } })).status()).toBe(400);
    expect((await manager.post(`/api/v1/employees/${trainer.id}/days-off`, { data: { date: "31/02/2030" } })).status()).toBe(400);
    expect((await manager.get("/api/v1/schedule/trainers")).status()).toBe(400);
  });

  test("a day off is added once; the second is a field error", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const trainer = await createTrainerViaApi(manager, testTag);

    expect((await manager.post(`/api/v1/employees/${trainer.id}/days-off`, { data: { date: BOOKING_DAY.date } })).status()).toBe(201);
    const again = await manager.post(`/api/v1/employees/${trainer.id}/days-off`, { data: { date: BOOKING_DAY.date } });

    expect(again.status()).toBe(400);
    expect(await again.json()).toMatchObject({ details: { fieldErrors: { date: ["dayOffExists"] } } });
  });
});
