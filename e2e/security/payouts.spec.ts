// OWASP A01 (access control, data scope), A04 (business rules), A06 (concurrency abuse) and A10 (input errors) for the
// PT payouts of M5.7 (brief §6.3, §8.1; D-027, D-032; FR-CASH-003; INT-011). Anonymous 401s are also walked by the route
// inventory of access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "../support/data";
import type { Role } from "../support/db";
import { createOptionViaApi } from "../support/options";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const ALLOWED: Role[] = ["ADMIN", "FITNESS_MANAGER", "ACCOUNTANT"];

test.describe("A01 who sees and makes payouts (docs/09)", () => {
  for (const role of ROLES) {
    const status = ALLOWED.includes(role) ? 200 : 403;
    test(`${role} reading /payouts gets ${status}`, async ({ apiAs }) => {
      const response = await (await apiAs(role)).get("/api/v1/payouts");
      expect(response.status()).toBe(status);
      if (status === 403) expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    });

    test(`${role} paying a PT gets ${ALLOWED.includes(role) ? "409 (nothing to pay)" : "403"}`, async ({
      apiAs,
      testTag,
    }) => {
      const admin = await apiAs("ADMIN");
      const { trainer } = await bookingSetup(apiAs, testTag);
      const response = await (
        await apiAs(role)
      ).post("/api/v1/payouts", {
        headers: { "idempotency-key": randomUUID() },
        data: {
          trainerId: trainer.id,
          from: "01/01/2027",
          to: "02/01/2027",
          categoryId: await createOptionViaApi(admin, "expenseTypes", `Chi ${testTag} ${role}`),
          methodId: await createOptionViaApi(admin, "paymentMethods", `Hình thức ${testTag} ${role}`),
        },
      });
      expect(response.status()).toBe(ALLOWED.includes(role) ? 409 : 403);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/payouts")).status()).toBe(401);
    expect((await anonymous.get(`/api/v1/payouts/${randomUUID()}`)).status()).toBe(401);
    expect((await anonymous.post("/api/v1/payouts", { data: {} })).status()).toBe(401);
  });
});

test.describe("A04, A06 and A10 the rules and the inputs", () => {
  test("a session is paid once, however many payouts race, and the amount is the system's", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { refs, trainer } = await bookingSetup(apiAs, testTag);
    const day = randomBookingDay();
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
      date: day.date,
      startTime: "09:00",
      endTime: "10:00",
    });
    expect((await admin.post(`/api/v1/bookings/${booking.id}/complete`)).status()).toBe(200);
    const body = {
      trainerId: trainer.id,
      from: day.date,
      to: day.date,
      categoryId: await createOptionViaApi(admin, "expenseTypes", `Chi ${testTag}`),
      methodId: await createOptionViaApi(admin, "paymentMethods", `Hình thức ${testTag}`),
      // Never taken from the request.
      amount: "999999999",
    };

    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin.post("/api/v1/payouts", { headers: { "idempotency-key": randomUUID() }, data: body }),
      ),
    );

    const created = answers.filter((answer) => [201, 202].includes(answer.status()));
    expect(created).toHaveLength(1);
    expect(answers.filter((answer) => answer.status() === 409)).toHaveLength(4);
    const payout = (await created[0]!.json()) as { id: string; amount: number; lines: unknown[] };
    expect(payout).toMatchObject({ amount: 500_000 });
    expect(payout.lines).toHaveLength(1);
    expect((await admin.get(`/api/v1/payouts/${payout.id}`)).status()).toBe(200);
  });

  test("a bad request is a 400 or 404, never a 500", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { trainer } = await bookingSetup(apiAs, testTag);
    const valid = {
      trainerId: trainer.id,
      from: "01/01/2027",
      to: "02/01/2027",
      categoryId: await createOptionViaApi(admin, "expenseTypes", `Chi ${testTag}`),
      methodId: await createOptionViaApi(admin, "paymentMethods", `Hình thức ${testTag}`),
    };
    const post = (data: Record<string, unknown>, key: string | null = randomUUID()) =>
      admin.post("/api/v1/payouts", { headers: key ? { "idempotency-key": key } : {}, data });

    expect((await post(valid, null)).status()).toBe(400);
    for (const data of [
      {},
      { ...valid, trainerId: "nope" },
      { ...valid, trainerId: randomUUID() },
      { ...valid, from: "31/02/2027" },
      { ...valid, from: "10/01/2027", to: "01/01/2027" },
      { ...valid, categoryId: valid.methodId },
      { ...valid, methodId: "" },
    ]) {
      expect((await post(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    expect((await admin.get("/api/v1/payouts/not-a-uuid")).status()).toBe(404);
    expect((await admin.get(`/api/v1/payouts/${randomUUID()}`)).status()).toBe(404);
    for (const query of ["trainerId=nope", "from=2027-01-01", "page=0", "pageSize=101"]) {
      expect((await admin.get(`/api/v1/payouts?${query}`)).status(), query).toBe(400);
    }
  });

  test("a reused key with another request is refused", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { trainer } = await bookingSetup(apiAs, testTag);
    const data = {
      trainerId: trainer.id,
      from: "01/01/2027",
      to: "02/01/2027",
      categoryId: await createOptionViaApi(admin, "expenseTypes", `Chi ${testTag}`),
      methodId: await createOptionViaApi(admin, "paymentMethods", `Hình thức ${testTag}`),
    };
    const key = randomUUID();
    // Nothing to pay is a 409 and stores nothing, so the key is still free for a different request.
    expect((await admin.post("/api/v1/payouts", { headers: { "idempotency-key": key }, data })).status()).toBe(409);
    expect(
      (
        await admin.post("/api/v1/payouts", {
          headers: { "idempotency-key": key },
          data: { ...data, to: "03/01/2027" },
        })
      ).status(),
    ).toBe(409);
  });
});
