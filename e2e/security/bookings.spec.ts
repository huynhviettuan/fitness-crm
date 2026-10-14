// OWASP A01 (access control, mass assignment), A06 (concurrency abuse), A10 (input
// errors) for the booking and session routes added in Phase 3 (employees: employees.spec.ts). Route-level
// 401s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { BOOKING_DAY, bookingSetup, createBookingViaApi, createTrainerViaApi, gymDay } from "../support/data";
import type { Role } from "../support/db";
import { otherOptionId } from "../support/options";

const SLOT = { date: BOOKING_DAY.date, startTime: "18:00", endTime: "19:00" };

test.describe("A01 trainer, booking, and session roles (docs/09, A-016)", () => {
  const bookingExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["RECEPTIONIST", 201],
    // A-007: a trainer books only for their own trainer record.
    ["PT", 403],
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
    ["FITNESS_MANAGER", 200],
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

  const deleteExpectations: [Role, number][] = [
    ["ADMIN", 204],
    ["FITNESS_MANAGER", 204],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of deleteExpectations) {
    test(`${role} deleting a booked session gets ${status}`, async ({ apiAs, testTag }) => {
      const { refs } = await bookingSetup(apiAs, testTag);
      const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);
      const reasonId = await otherOptionId(await apiAs("ADMIN"), "deleteReasons");

      const response = await (
        await apiAs(role)
      ).delete(`/api/v1/bookings/${booking.id}`, {
        data: { reasonId, reasonNote: "Đặt nhầm" },
      });
      expect(response.status()).toBe(status);
    });
  }

  test("a deleted session needs a reason, disappears, and is refused once trained or checked in", async ({
    apiAs,
    testTag,
  }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const booking = await createBookingViaApi(manager, refs, SLOT);
    const reason = { reasonId: await otherOptionId(await apiAs("ADMIN"), "deleteReasons"), reasonNote: "Đặt nhầm" };

    expect((await manager.delete(`/api/v1/bookings/${booking.id}`, { data: {} })).status()).toBe(400);
    expect((await manager.delete(`/api/v1/bookings/${booking.id}`, { data: reason })).status()).toBe(204);
    expect((await manager.get(`/api/v1/bookings/${booking.id}`)).status()).toBe(404);
    // A second delete finds nothing; a checked-in session cannot be deleted.
    expect((await manager.delete(`/api/v1/bookings/${booking.id}`, { data: reason })).status()).toBe(404);
    const second = await createBookingViaApi(manager, refs, { ...SLOT, startTime: "20:00", endTime: "21:00" });
    await manager.post(`/api/v1/bookings/${second.id}/check-in`);
    expect((await manager.delete(`/api/v1/bookings/${second.id}`, { data: reason })).status()).toBe(409);
  });

  test("bulk completion is for the roles that complete, validates its list, and cannot reach another trainer's sessions", async ({
    apiAs,
    testTag,
  }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);

    expect(
      (
        await (
          await apiAs("RECEPTIONIST")
        ).post("/api/v1/bookings/complete-day", { data: { bookingIds: [booking.id] } })
      ).status(),
    ).toBe(403);
    const manager = await apiAs("FITNESS_MANAGER");
    for (const data of [{}, { bookingIds: [] }, { bookingIds: ["x"] }, { bookingIds: Array(201).fill(booking.id) }]) {
      expect(
        (await manager.post("/api/v1/bookings/complete-day", { data })).status(),
        JSON.stringify(data).slice(0, 30),
      ).toBe(400);
    }
    // A PT reaches only their own sessions (A-007): another trainer's comes back NOT_FOUND, untouched.
    const pt = await (await apiAs("PT")).post("/api/v1/bookings/complete-day", { data: { bookingIds: [booking.id] } });
    expect(pt.status()).toBe(200);
    expect(await pt.json()).toMatchObject({ completed: 0, items: [{ ok: false, code: "NOT_FOUND" }] });
    expect((await (await manager.get(`/api/v1/bookings/${booking.id}`)).json()).status).toBe("BOOKED");
    expect((await manager.post("/api/v1/bookings/complete-day", { data: { bookingIds: [booking.id] } })).status()).toBe(
      200,
    );
  });

  test("an accountant can read bookings but not check in, cancel, or mark no-show", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);
    const accountant = await apiAs("ACCOUNTANT");

    expect((await accountant.get(`/api/v1/bookings/${booking.id}`)).status()).toBe(200);
    for (const action of ["check-in", "cancel", "no-show"]) {
      expect((await accountant.post(`/api/v1/bookings/${booking.id}/${action}`)).status(), action).toBe(403);
    }
  });

  test("a trainer cannot open or act on another trainer's booking, even with its real id (A-007)", async ({
    apiAs,
    testTag,
  }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, SLOT);
    const trainer = await apiAs("PT");

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
        data: {
          ...SLOT,
          trainerId: refs.trainerId,
          customerId: other.refs.customerId,
          contractId: other.refs.contractId,
          startTime: "20:00",
          endTime: "21:00",
        },
      })
    ).json();
    expect(moved).toMatchObject({ customer: { id: refs.customerId }, contract: { id: refs.contractId } });
  });
});

test.describe("A06 concurrency abuse over HTTP", () => {
  test("ten simultaneous completions consume one session (INT-001)", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const booking = await createBookingViaApi(manager, refs, SLOT);
    await manager.post(`/api/v1/bookings/${booking.id}/check-in`);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => manager.post(`/api/v1/bookings/${booking.id}/complete`)),
    );

    expect(responses.map((r) => r.status())).toEqual(Array(10).fill(200));
    const contract = await (await manager.get(`/api/v1/contracts/${refs.contractId}`)).json();
    expect(contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
  });

  test("two overlapping bookings sent together: one is created (INT-003)", async ({ apiAs, testTag }) => {
    const first = await bookingSetup(apiAs, testTag);
    const second = await bookingSetup(apiAs, `${testTag}b`);
    const manager = await apiAs("FITNESS_MANAGER");

    const responses = await Promise.all([
      manager.post("/api/v1/bookings", { data: { ...first.refs, ...SLOT } }),
      manager.post("/api/v1/bookings", {
        data: { ...second.refs, trainerId: first.refs.trainerId, ...SLOT, startTime: "18:30", endTime: "19:30" },
      }),
    ]);

    expect(responses.map((r) => r.status()).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status() === 409)!;
    expect(await refused.json()).toMatchObject({ code: "BOOKING_TRAINER_OVERLAP" });
  });

  test("two sessions for one customer at once with different trainers: one is created (BR-403)", async ({
    apiAs,
    testTag,
  }) => {
    const first = await bookingSetup(apiAs, testTag);
    const other = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), `${testTag}b`);
    const manager = await apiAs("FITNESS_MANAGER");

    const responses = await Promise.all([
      manager.post("/api/v1/bookings", { data: { ...first.refs, ...SLOT } }),
      manager.post("/api/v1/bookings", { data: { ...first.refs, trainerId: other.id, ...SLOT } }),
    ]);

    expect(responses.map((r) => r.status()).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status() === 409)!;
    expect(await refused.json()).toMatchObject({ code: "BOOKING_CUSTOMER_OVERLAP" });
  });
});

test.describe("A10 PT grid query (M5.2)", () => {
  test("the schedule refuses a bad day count and malformed ids, and a foreign branch shows nothing", async ({
    apiAs,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const day = `date=${BOOKING_DAY.date}`;

    for (const query of [
      `${day}&days=8`,
      `${day}&days=0`,
      `${day}&customerId=x`,
      `${day}&branchId=x`,
      `${day}&trainerId=x`,
    ]) {
      expect((await reception.get(`/api/v1/schedule?${query}`)).status(), query).toBe(400);
    }
    const foreign = await reception.get(`/api/v1/schedule?${day}&branchId=${randomUUID()}`);
    expect(foreign.status()).toBe(200);
    expect((await foreign.json()).items).toEqual([]);
  });
});

test.describe("A10 booking input errors", () => {
  test("invalid times and references are field errors, not 500s", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");

    const backwards = await reception.post("/api/v1/bookings", {
      data: { ...refs, ...SLOT, startTime: "19:00", endTime: "18:00" },
    });
    expect(backwards.status()).toBe(400);
    expect(await backwards.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fieldErrors: { endTime: ["endTimeNotAfterStart"] } },
    });

    const malformed = await reception.post("/api/v1/bookings", {
      data: { ...refs, trainerId: "1; DROP TABLE bookings", ...SLOT, startTime: "99:99" },
    });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toMatchObject({
      details: { fieldErrors: { trainerId: ["invalidChoice"], startTime: ["invalidTime"] } },
    });
  });

  test("business rules answer with their documented codes", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const other = await bookingSetup(apiAs, `${testTag}b`);
    const reception = await apiAs("RECEPTIONIST");

    const mismatch = await reception.post("/api/v1/bookings", {
      data: { ...refs, customerId: other.refs.customerId, ...SLOT },
    });
    expect(mismatch.status()).toBe(422);
    expect(await mismatch.json()).toMatchObject({ code: "BOOKING_CUSTOMER_CONTRACT_MISMATCH" });

    const outside = await reception.post("/api/v1/bookings", { data: { ...refs, ...SLOT, date: "01/10/2031" } });
    expect(outside.status()).toBe(422);
    expect(await outside.json()).toMatchObject({ code: "BOOKING_OUTSIDE_CONTRACT_PERIOD" });

    // A cancelled session cannot be completed (D-025).
    const booking = await createBookingViaApi(reception, refs, SLOT);
    await reception.post(`/api/v1/bookings/${booking.id}/cancel`);
    const refused = await (await apiAs("FITNESS_MANAGER")).post(`/api/v1/bookings/${booking.id}/complete`);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  test("unknown or malformed booking ids are 404 for every action", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    for (const id of [randomUUID(), "not-a-uuid"]) {
      for (const action of ["check-in", "complete", "cancel", "no-show"]) {
        const response = await manager.post(`/api/v1/bookings/${id}/${action}`);
        expect(response.status(), `${action} ${id}`).toBe(404);
      }
    }
  });
});

// Delete from the check-in history and Burn Show (M5.4, D-026, D-028): Admin's only.
test.describe("A01 the check-in history and Burn Show are Admin's (docs/09, A-157, A-158)", () => {
  const PAST = { date: gymDay(-1), startTime: "09:00", endTime: "10:00" };
  const roles: [Role, number][] = [
    ["ADMIN", 204],
    ["FITNESS_MANAGER", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of roles) {
    test(`${role} deleting a trained session from the history gets ${status}`, async ({ apiAs, testTag }) => {
      const { refs } = await bookingSetup(apiAs, testTag);
      const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, PAST);
      const admin = await apiAs("ADMIN");
      await admin.post(`/api/v1/bookings/${booking.id}/complete`);
      const reasonId = await otherOptionId(admin, "deleteReasons");

      const response = await (
        await apiAs(role)
      ).delete(`/api/v1/bookings/${booking.id}/history`, { data: { reasonId, reasonNote: "Ghi nhầm" } });
      expect(response.status()).toBe(status);
    });

    test(`${role} adding a session with Burn Show gets ${status === 204 ? 201 : status}`, async ({
      apiAs,
      testTag,
    }) => {
      const { refs } = await bookingSetup(apiAs, testTag);
      const reasonId = await otherOptionId(await apiAs("ADMIN"), "burnShowReasons");

      const response = await (
        await apiAs(role)
      ).post("/api/v1/bookings/burn", {
        data: { contractId: refs.contractId, trainerId: refs.trainerId, ...PAST, reasonId, reasonNote: "Quên quét" },
      });
      expect(response.status()).toBe(status === 204 ? 201 : status);
    });
  }

  test("the history keeps its locks: a booked session is refused, a repeat finds nothing, the reason is required", async ({
    apiAs,
    testTag,
  }) => {
    const { refs, contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const booked = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, PAST);
    const reason = { reasonId: await otherOptionId(admin, "deleteReasons"), reasonNote: "Ghi nhầm" };
    const history = (id: string, data: unknown) => admin.delete(`/api/v1/bookings/${id}/history`, { data });

    // Not trained yet: refused. Trained: a reason is needed, then it works once and the repeat finds nothing.
    expect((await history(booked.id, reason)).status()).toBe(409);
    await admin.post(`/api/v1/bookings/${booked.id}/complete`);
    expect((await history(booked.id, {})).status()).toBe(400);
    expect((await history(booked.id, { reasonId: reason.reasonId, reasonNote: "" })).status()).toBe(400);
    expect((await history(booked.id, reason)).status()).toBe(204);
    expect((await history(booked.id, reason)).status()).toBe(404);
    expect((await history("not-a-uuid", reason)).status()).toBe(404);
    expect((await admin.get(`/api/v1/contracts/${contract.id}`).then((r) => r.json())).remainingSessions).toBe(24);
  });

  test("Burn Show validates its input and runs the booking rules, never a 500", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const reasonId = await otherOptionId(admin, "burnShowReasons");
    const valid = {
      contractId: refs.contractId,
      trainerId: refs.trainerId,
      ...PAST,
      reasonId,
      reasonNote: "Quên quét",
    };
    const burn = (data: unknown) => admin.post("/api/v1/bookings/burn", { data });

    for (const data of [
      {},
      { ...valid, reasonId: "" },
      { ...valid, reasonNote: "" },
      { ...valid, reasonNote: "a\u0007b" },
      { ...valid, endTime: "08:00" },
      { ...valid, date: "31/02/2026" },
      { ...valid, contractId: "nope" },
      { ...valid, date: "01/01/2099" },
    ]) {
      const response = await burn(data);
      expect(response.status(), JSON.stringify(data).slice(0, 80)).toBeLessThan(500);
    }
    // Unknown contract: not found. The first valid one works; the same hour again clashes with it.
    expect((await burn({ ...valid, contractId: randomUUID() })).status()).toBe(404);
    // The customer, the status and the flags are never taken from the client.
    const created = await burn({
      ...valid,
      customerId: randomUUID(),
      status: "CANCELLED",
      consumes: false,
      creditsPt: false,
      addedByHand: false,
    });
    expect(created.status()).toBe(201);
    expect(await created.json()).toMatchObject({
      status: "TRAINED",
      consumes: true,
      creditsPt: true,
      addedByHand: true,
      customer: { id: refs.customerId },
    });
    expect((await burn(valid)).status()).toBe(409);
  });
});
