// OWASP A01 (access control), A04 (business rules), A06 (concurrency abuse), A10 (input errors) for the class schedule
// of M5.5 (brief §6.4, BR-411). Route-level 401s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { classSetup, createCustomerViaApi } from "../support/data";
import type { Role } from "../support/db";

test.describe("A01 the class schedule is for its roles (docs/09, A-160)", () => {
  const viewRoles: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["RECEPTIONIST", 200],
    ["PT", 200],
    ["ACCOUNTANT", 200],
    ["CONSULTING", 403],
  ];
  for (const [role, status] of viewRoles) {
    test(`${role} reading the classes and the grid gets ${status}`, async ({ apiAs, testTag }) => {
      const { today } = await classSetup(apiAs, testTag);
      const api = await apiAs(role);
      expect((await api.get("/api/v1/classes")).status()).toBe(status);
      expect((await api.get("/api/v1/class-sessions?date=01/01/2027")).status()).toBe(status);
      expect((await api.get(`/api/v1/class-sessions/${today.id}`)).status()).toBe(status);
    });
  }

  const manageRoles: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of manageRoles) {
    test(`${role} adding a class gets ${status}`, async ({ apiAs, testTag }) => {
      const { coach } = await classSetup(apiAs, `${testTag}x`);
      const me = (await (await apiAs("ADMIN")).get("/api/v1/me")).json();
      const branchId = ((await me) as { branches: { id: string }[] }).branches[0]!.id;
      const response = await (
        await apiAs(role)
      ).post("/api/v1/classes", {
        data: {
          name: `Lớp ${testTag}`,
          branchId,
          coachId: coach.id,
          capacity: 5,
          weekdays: [2],
          startTime: "12:15",
          endTime: "13:15",
        },
      });
      expect(response.status()).toBe(status);
    });
  }

  const enrollRoles: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["RECEPTIONIST", 201],
    ["ACCOUNTANT", 403],
    ["CONSULTING", 403],
  ];
  for (const [role, status] of enrollRoles) {
    test(`${role} enrolling a customer gets ${status}`, async ({ apiAs, testTag }) => {
      const { customer, contract, tomorrow } = await classSetup(apiAs, testTag);
      const response = await (
        await apiAs(role)
      ).post(`/api/v1/class-sessions/${tomorrow.id}/attendees`, {
        data: { customerId: customer.id, contractId: contract.id },
      });
      expect(response.status()).toBe(status);
    });
  }

  const markRoles: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["RECEPTIONIST", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of markRoles) {
    test(`${role} marking attendance gets ${status}`, async ({ apiAs, testTag }) => {
      const { customer, contract, today } = await classSetup(apiAs, testTag);
      const admin = await apiAs("ADMIN");
      const session = await (
        await admin.post(`/api/v1/class-sessions/${today.id}/attendees`, {
          data: { customerId: customer.id, contractId: contract.id },
        })
      ).json();

      const response = await (
        await apiAs(role)
      ).post(`/api/v1/class-sessions/${today.id}/attendees/${session.attendees[0].id}/mark`, {
        data: { status: "PRESENT" },
      });
      expect(response.status()).toBe(status);
    });
  }

  test("a PT who is not the coach cannot enroll in or mark another coach's class", async ({ apiAs, testTag }) => {
    const { customer, contract, today } = await classSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const session = await (
      await admin.post(`/api/v1/class-sessions/${today.id}/attendees`, {
        data: { customerId: customer.id, contractId: contract.id },
      })
    ).json();
    const pt = await apiAs("PT");

    const enroll = await pt.post(`/api/v1/class-sessions/${today.id}/attendees`, {
      data: { customerId: customer.id, contractId: contract.id },
    });
    const mark = await pt.post(`/api/v1/class-sessions/${today.id}/attendees/${session.attendees[0].id}/mark`, {
      data: { status: "PRESENT" },
    });
    expect([enroll.status(), mark.status()]).toEqual([403, 403]);
  });
});

test.describe("A04 and A10 the rules and the inputs", () => {
  test("enrollment keeps its rules: another customer's contract, a PT contract, twice, and a full class", async ({
    apiAs,
    testTag,
  }) => {
    const { customer, contract, tomorrow } = await classSetup(apiAs, testTag, { capacity: 1 });
    const other = await classSetup(apiAs, `${testTag}o`);
    const reception = await apiAs("RECEPTIONIST");
    const enroll = (customerId: string, contractId: string) =>
      reception.post(`/api/v1/class-sessions/${tomorrow.id}/attendees`, { data: { customerId, contractId } });

    // A contract that belongs to someone else, and a customer with no contract at all.
    expect((await enroll(customer.id, other.contract.id)).status()).toBe(422);
    const stranger = await createCustomerViaApi(reception, `${testTag}s`);
    expect((await enroll(stranger.id, contract.id)).status()).toBe(422);
    expect((await enroll(customer.id, contract.id)).status()).toBe(201);
    expect((await enroll(customer.id, contract.id)).status()).toBe(409);
    // The one seat is taken.
    expect((await enroll(other.customer.id, other.contract.id)).status()).toBe(409);
  });

  test("seats are given out once under concurrent requests, and a mark consumes once", async ({ apiAs, testTag }) => {
    const first = await classSetup(apiAs, testTag, { capacity: 1 });
    const second = await classSetup(apiAs, `${testTag}b`);
    const reception = await apiAs("RECEPTIONIST");
    const enroll = (who: { customer: { id: string }; contract: { id: string } }) =>
      reception.post(`/api/v1/class-sessions/${first.today.id}/attendees`, {
        data: { customerId: who.customer.id, contractId: who.contract.id },
      });

    const answers = await Promise.all([enroll(first), enroll(second), enroll(first), enroll(second)]);
    expect(answers.filter((answer) => answer.status() === 201)).toHaveLength(1);

    const admin = await apiAs("ADMIN");
    const detail = (await (await admin.get(`/api/v1/class-sessions/${first.today.id}`)).json()) as {
      attendees: { id: string; customer: { id: string }; contract: { id: string } }[];
    };
    expect(detail.attendees).toHaveLength(1);
    const attendee = detail.attendees[0]!;
    const marks = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin.post(`/api/v1/class-sessions/${first.today.id}/attendees/${attendee.id}/mark`, {
          data: { status: "PRESENT" },
        }),
      ),
    );
    expect(marks.map((mark) => mark.status())).toEqual([200, 200, 200, 200]);
    const contract = (await (await admin.get(`/api/v1/contracts/${attendee.contract.id}`)).json()) as {
      remainingSessions: number;
    };
    expect(contract.remainingSessions).toBe(11);
    // A mark is final.
    const flip = await admin.post(`/api/v1/class-sessions/${first.today.id}/attendees/${attendee.id}/mark`, {
      data: { status: "ABSENT" },
    });
    expect(flip.status()).toBe(409);
  });

  test("attendance waits for the class to start", async ({ apiAs, testTag }) => {
    const { customer, contract, tomorrow } = await classSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const session = await (
      await admin.post(`/api/v1/class-sessions/${tomorrow.id}/attendees`, {
        data: { customerId: customer.id, contractId: contract.id },
      })
    ).json();
    const mark = await admin.post(`/api/v1/class-sessions/${tomorrow.id}/attendees/${session.attendees[0].id}/mark`, {
      data: { status: "PRESENT" },
    });
    expect(mark.status()).toBe(409);
  });

  test("input errors are 400 or 404, never a 500", async ({ apiAs, testTag }) => {
    const { coach, today } = await classSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const me = (await (await admin.get("/api/v1/me")).json()) as { branches: { id: string }[] };
    const valid = {
      name: `Lớp ${testTag}`,
      branchId: me.branches[0]!.id,
      coachId: coach.id,
      capacity: 5,
      weekdays: [2],
      startTime: "12:15",
      endTime: "13:15",
    };
    for (const data of [
      {},
      { ...valid, weekdays: [] },
      { ...valid, weekdays: [8] },
      { ...valid, capacity: 0 },
      { ...valid, capacity: 501 },
      { ...valid, endTime: "12:00" },
      { ...valid, startTime: "25:00" },
      { ...valid, name: "a\u0007b" },
      { ...valid, name: "x".repeat(101) },
      { ...valid, coachId: randomUUID() },
      { ...valid, branchId: "nope" },
    ]) {
      const response = await admin.post("/api/v1/classes", { data });
      expect(response.status(), JSON.stringify(data).slice(0, 70)).toBe(400);
    }
    const missing = randomUUID();
    expect((await admin.get("/api/v1/class-sessions/not-a-uuid")).status()).toBe(404);
    expect((await admin.get(`/api/v1/class-sessions/${missing}`)).status()).toBe(404);
    expect((await admin.get("/api/v1/class-sessions?date=31/02/2027")).status()).toBe(400);
    expect((await admin.get("/api/v1/class-sessions?date=01/01/2027&days=8")).status()).toBe(400);
    expect(
      (
        await admin.patch(`/api/v1/classes/${missing}`, {
          data: { name: "x", coachId: coach.id, capacity: 3, active: true },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await admin.post(`/api/v1/class-sessions/${today.id}/attendees/${missing}/mark`, {
          data: { status: "PRESENT" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await admin.post(`/api/v1/class-sessions/${today.id}/attendees/${missing}/mark`, {
          data: { status: "ENROLLED" },
        })
      ).status(),
    ).toBe(400);
    expect((await admin.delete(`/api/v1/class-sessions/${today.id}/attendees/${missing}`)).status()).toBe(404);
  });
});
