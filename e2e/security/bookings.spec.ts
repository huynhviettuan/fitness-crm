// OWASP A01 (access control, mass assignment), A06 (concurrency abuse), A10 (input
// errors) for the trainer, booking, and session routes added in Phase 3. Route-level
// 401s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { BOOKING_DAY, bookingSetup, createBookingViaApi, createTrainerViaApi } from "../support/data";
import type { Role } from "../../src/lib/permissions";

const SLOT = { date: BOOKING_DAY.date, startTime: "18:00", endTime: "19:00" };

test.describe("A01 trainer, booking, and session roles (docs/09, A-016)", () => {
  const trainerExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["MANAGER", 201],
    ["RECEPTIONIST", 403],
    ["TRAINER", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of trainerExpectations) {
    test(`${role} creating a trainer gets ${status}`, async ({ apiAs, testTag }) => {
      const response = await (await apiAs(role)).post("/api/v1/trainers", { data: { fullName: `PT ${testTag}` } });
      expect(response.status()).toBe(status);
    });
  }

  const bookingExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["MANAGER", 201],
    ["RECEPTIONIST", 201],
    // A-007: a trainer books only for their own trainer record.
    ["TRAINER", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of bookingExpectations) {
    test(`${role} booking for a test trainer gets ${status}`, async ({ apiAs, testTag }) => {
      const { refs } = await bookingSetup(apiAs, testTag);
      const response = await (await apiAs(role)).post("/api/v1/bookings", { data: { ...refs, ...SLOT } });
      expect(response.status()).toBe(status);
    });
  }

  const completeExpectations: [Role, number][] = [
    // OQ-011: the receptionist's "limited" completion is not defined, so denied (T-024).
    ["RECEPTIONIST", 403],
    ["ACCOUNTANT", 403],
    ["MANAGER", 200],
  ];
  for (const [role, status] of completeExpectations) {
    test(`${role} completing a checked-in session gets ${status}`, async ({ apiAs, testTag }) => {
      const { refs } = await bookingSetup(apiAs, testTag);
      const reception = await apiAs("RECEPTIONIST");
      const booking = await createBookingViaApi(reception, refs, SLOT);
      await reception.post(`/api/v1/bookings/${booking.id}/check-in`);

      const response = await (await apiAs(role)).post(`/api/v1/bookings/${booking.id}/complete`);
      expect(response.status()).toBe(status);
    });
  }

  test("an accountant can read bookings but not check in, cancel, or mark no-show", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);
    const accountant = await apiAs("ACCOUNTANT");

    expect((await accountant.get(`/api/v1/bookings/${booking.id}`)).status()).toBe(200);
    for (const action of ["check-in", "cancel", "no-show"]) {
      expect((await accountant.post(`/api/v1/bookings/${booking.id}/${action}`)).status(), action).toBe(403);
    }
  });

  test("a trainer cannot open or act on another trainer's booking, even with its real id (A-007)", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);
    const trainer = await apiAs("TRAINER");

    expect((await trainer.get(`/api/v1/bookings/${booking.id}`)).status()).toBe(404);
    expect((await trainer.post(`/api/v1/bookings/${booking.id}/cancel`)).status()).toBe(404);
    expect((await (await trainer.get(`/api/v1/bookings?customerId=${refs.customerId}`)).json()).total).toBe(0);
  });

  test("status, times, and session facts cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");

    const response = await reception.post("/api/v1/bookings", {
      data: {
        ...refs,
        ...SLOT,
        status: "COMPLETED",
        scheduledStart: "2000-01-01T00:00:00Z",
        session: { completedAt: "2000-01-01T00:00:00Z" },
      },
    });
    const created = await response.json();
    expect(created).toMatchObject({ status: "BOOKED", session: null, contract: { remainingSessions: 24 } });
    expect(created.scheduledStart).toBe("2030-06-20T11:00:00.000Z");

    // A reschedule cannot move the booking to another customer or contract.
    const other = await bookingSetup(apiAs, `${testTag}b`);
    const moved = await (
      await reception.patch(`/api/v1/bookings/${created.id}`, {
        data: { ...SLOT, trainerId: refs.trainerId, customerId: other.refs.customerId, contractId: other.refs.contractId, startTime: "20:00", endTime: "21:00" },
      })
    ).json();
    expect(moved).toMatchObject({ customer: { id: refs.customerId }, contract: { id: refs.contractId } });
  });

  test("a trainer's login link cannot be pointed at a non-trainer account", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { id: adminId } = await (await admin.get("/api/v1/auth/me")).json();

    const response = await admin.post("/api/v1/trainers", { data: { fullName: `PT ${testTag}`, userId: adminId } });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ details: { fieldErrors: { userId: ["userNotTrainer"] } } });
  });
});

test.describe("A06 concurrency abuse over HTTP", () => {
  test("ten simultaneous completions consume one session (INT-001)", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("MANAGER");
    const booking = await createBookingViaApi(manager, refs, SLOT);
    await manager.post(`/api/v1/bookings/${booking.id}/check-in`);

    const responses = await Promise.all(Array.from({ length: 10 }, () => manager.post(`/api/v1/bookings/${booking.id}/complete`)));

    expect(responses.map((r) => r.status())).toEqual(Array(10).fill(200));
    const contract = await (await manager.get(`/api/v1/contracts/${refs.contractId}`)).json();
    expect(contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
  });

  test("two overlapping bookings sent together: one is created (INT-003)", async ({ apiAs, testTag }) => {
    const first = await bookingSetup(apiAs, testTag);
    const second = await bookingSetup(apiAs, `${testTag}b`);
    const manager = await apiAs("MANAGER");

    const responses = await Promise.all([
      manager.post("/api/v1/bookings", { data: { ...first.refs, ...SLOT } }),
      manager.post("/api/v1/bookings", { data: { ...second.refs, trainerId: first.refs.trainerId, ...SLOT, startTime: "18:30", endTime: "19:30" } }),
    ]);

    expect(responses.map((r) => r.status()).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status() === 409)!;
    expect(await refused.json()).toMatchObject({ code: "BOOKING_TRAINER_OVERLAP" });
  });
});

test.describe("A10 booking input errors", () => {
  test("invalid times and references are field errors, not 500s", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");

    const backwards = await reception.post("/api/v1/bookings", { data: { ...refs, ...SLOT, startTime: "19:00", endTime: "18:00" } });
    expect(backwards.status()).toBe(400);
    expect(await backwards.json()).toMatchObject({ code: "VALIDATION_FAILED", details: { fieldErrors: { endTime: ["endTimeNotAfterStart"] } } });

    const malformed = await reception.post("/api/v1/bookings", { data: { ...refs, trainerId: "1; DROP TABLE bookings", ...SLOT, startTime: "99:99" } });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toMatchObject({ details: { fieldErrors: { trainerId: ["invalidChoice"], startTime: ["invalidTime"] } } });
  });

  test("business rules answer with their documented codes", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const other = await bookingSetup(apiAs, `${testTag}b`);
    const reception = await apiAs("RECEPTIONIST");

    const mismatch = await reception.post("/api/v1/bookings", { data: { ...refs, customerId: other.refs.customerId, ...SLOT } });
    expect(mismatch.status()).toBe(422);
    expect(await mismatch.json()).toMatchObject({ code: "BOOKING_CUSTOMER_CONTRACT_MISMATCH" });

    const outside = await reception.post("/api/v1/bookings", { data: { ...refs, ...SLOT, date: "01/01/2031" } });
    expect(outside.status()).toBe(422);
    expect(await outside.json()).toMatchObject({ code: "BOOKING_OUTSIDE_CONTRACT_PERIOD" });

    const booking = await createBookingViaApi(reception, refs, SLOT);
    const early = await (await apiAs("MANAGER")).post(`/api/v1/bookings/${booking.id}/complete`);
    expect(early.status()).toBe(409);
    expect(await early.json()).toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  test("unknown or malformed booking ids are 404 for every action", async ({ apiAs }) => {
    const manager = await apiAs("MANAGER");
    for (const id of [randomUUID(), "not-a-uuid"]) {
      for (const action of ["check-in", "complete", "cancel", "no-show"]) {
        const response = await manager.post(`/api/v1/bookings/${id}/${action}`);
        expect(response.status(), `${action} ${id}`).toBe(404);
      }
    }
  });

  test("a trainer update with an unknown id is 404, and invalid fields are 400", async ({ apiAs, testTag }) => {
    const manager = await apiAs("MANAGER");
    const trainer = await createTrainerViaApi(manager, testTag);

    expect((await manager.patch(`/api/v1/trainers/${randomUUID()}`, { data: { fullName: "X" } })).status()).toBe(404);
    const invalid = await manager.patch(`/api/v1/trainers/${trainer.id}`, { data: { fullName: "", status: "FIRED" } });
    expect(invalid.status()).toBe(400);
  });
});
