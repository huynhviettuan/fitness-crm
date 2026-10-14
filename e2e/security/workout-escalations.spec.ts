// OWASP A01 (access control), A03 (stored script) and A10 (input errors) for the escalations of M7.4 (brief §7.4,
// FR-WKO-004). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "../support/data";
import type { Role } from "../support/db";
import { workoutCatalog, type ApiAs } from "../support/workouts";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const SEE: Role[] = ["ADMIN", "FITNESS_MANAGER", "PT"];
const CLOSE: Role[] = ["ADMIN", "FITNESS_MANAGER"];

/** An escalation about a session taught by a trainer of its own: a log with a set whose Action is the stop. */
async function escalation(apiAs: ApiAs, tag: string): Promise<{ id: string }> {
  const { refs } = await bookingSetup(apiAs, tag);
  const catalog = await workoutCatalog(apiAs, tag);
  const day = randomBookingDay();
  const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
    date: day.date,
    startTime: "10:00",
    endTime: "11:00",
  });
  const manager = await apiAs("FITNESS_MANAGER");
  const log = (await (await manager.post("/api/v1/workout/logs", { data: { bookingId: booking.id } })).json()) as {
    id: string;
  };
  const options = async (list: string) =>
    (
      (await (await manager.get(`/api/v1/option-lists/${list}/options`)).json()) as {
        items: { id: string; code: string | null }[];
      }
    ).items;
  const flag = (await options("workoutFlags")).find((option) => option.code === "STRESS")!;
  const action = (await options("workoutActions")).find((option) => option.code === "STOP_ESCALATION")!;
  const saved = await manager.put(`/api/v1/workout/logs/${log.id}`, {
    data: {
      items: [
        { exerciseId: catalog.squatId, sets: [{ weight: "40", reps: "5", flagId: flag.id, actionId: action.id }] },
      ],
    },
  });
  expect(saved.status()).toBe(200);
  const page = (await (await manager.get("/api/v1/workout/escalations?status=WAITING&pageSize=100")).json()) as {
    items: { id: string; logId: string }[];
  };
  const found = page.items.find((item) => item.logId === log.id);
  if (!found) throw new Error("The escalation was not raised");
  return found;
}

test.describe("A01 who reads and closes escalations", () => {
  for (const role of ROLES) {
    test(`${role} listing escalations gets ${SEE.includes(role) ? 200 : 403}`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/workout/escalations")).status()).toBe(
        SEE.includes(role) ? 200 : 403,
      );
    });
  }

  test("only Admin and the manager mark one seen; others get 403; a PT does not even see another coach's", async ({
    apiAs,
    testTag,
  }) => {
    const item = await escalation(apiAs, testTag);
    for (const role of ROLES.filter((candidate) => !CLOSE.includes(candidate))) {
      const response = await (
        await apiAs(role)
      ).post(`/api/v1/workout/escalations/${item.id}/seen`, {
        data: { direction: "ok" },
      });
      expect(response.status(), role).toBe(403);
    }
    // The PT is not the coach of this session, so the list holds none of it.
    const seenByPt = (await (await (await apiAs("PT")).get("/api/v1/workout/escalations?pageSize=100")).json()) as {
      items: { id: string }[];
    };
    expect(seenByPt.items.map((entry) => entry.id)).not.toContain(item.id);

    const closed = await (
      await apiAs("FITNESS_MANAGER")
    ).post(`/api/v1/workout/escalations/${item.id}/seen`, {
      data: { direction: "Nghỉ buổi này" },
    });
    expect(closed.status()).toBe(201);
    expect(await closed.json()).toMatchObject({ status: "SEEN", direction: "Nghỉ buổi này" });
    // Again: nothing changes.
    const again = await (
      await apiAs("ADMIN")
    ).post(`/api/v1/workout/escalations/${item.id}/seen`, {
      data: { direction: "Khác" },
    });
    expect(await again.json()).toMatchObject({ status: "SEEN", direction: "Nghỉ buổi này" });
  });

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/workout/escalations")).status()).toBe(401);
    expect(
      (await anonymous.post(`/api/v1/workout/escalations/${randomUUID()}/seen`, { data: { direction: "x" } })).status(),
    ).toBe(401);
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a script in a direction is kept as text, and bad requests are 400 or 404", async ({ apiAs, testTag }) => {
    const item = await escalation(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    for (const data of [
      {},
      { direction: "" },
      { direction: "   " },
      { direction: "a\u0007b" },
      { direction: "x".repeat(1001) },
    ]) {
      const response = await admin.post(`/api/v1/workout/escalations/${item.id}/seen`, { data });
      expect(response.status(), JSON.stringify(data).slice(0, 40)).toBe(400);
    }
    const script = `<script>alert(1)</script> ${testTag}`;
    const closed = await admin.post(`/api/v1/workout/escalations/${item.id}/seen`, { data: { direction: script } });
    expect(closed.status()).toBe(201);
    expect(await closed.json()).toMatchObject({ direction: script });
    expect(
      (await admin.post(`/api/v1/workout/escalations/${randomUUID()}/seen`, { data: { direction: "x" } })).status(),
    ).toBe(404);
    expect(
      (await admin.post("/api/v1/workout/escalations/not-a-uuid/seen", { data: { direction: "x" } })).status(),
    ).toBe(404);
    for (const query of ["status=NOPE", "pageSize=101", "page=0"]) {
      expect((await admin.get(`/api/v1/workout/escalations?${query}`)).status(), query).toBe(400);
    }
  });
});
