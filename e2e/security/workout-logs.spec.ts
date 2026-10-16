// OWASP A01 (access control), A03 (stored script) and A10 (input errors) for the session logs of M7.3 (brief §7.3,
// FR-WKO-003). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "../support/data";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const SEE: Role[] = ["ADMIN", "FITNESS_MANAGER", "PT"];

/** A PT session of a customer with the tag, taught by a trainer of its own (so no PT login owns it). */
async function session(apiAs: Parameters<typeof bookingSetup>[0], tag: string) {
  const { refs } = await bookingSetup(apiAs, tag);
  const day = randomBookingDay();
  return createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
    date: day.date,
    startTime: "10:00",
    endTime: "11:00",
  });
}

test.describe("A01 who reads and writes logs", () => {
  for (const role of ROLES) {
    test(`${role} listing logs gets ${SEE.includes(role) ? 200 : 403}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      expect((await api.get("/api/v1/workout/logs")).status()).toBe(SEE.includes(role) ? 200 : 403);
      expect((await api.get(`/api/v1/workout/logs/${randomUUID()}`)).status()).toBe(SEE.includes(role) ? 404 : 403);
    });
  }

  test("opening a log is for Admin and the manager; the PT only for their own sessions; others get 403", async ({
    apiAs,
    testTag,
  }) => {
    const booking = await session(apiAs, testTag);
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT"] as Role[]) {
      const response = await (await apiAs(role)).post("/api/v1/workout/logs", { data: { bookingId: booking.id } });
      expect(response.status(), role).toBe(403);
    }
    // The session belongs to another trainer, so a PT does not even see it.
    expect((await (await apiAs("PT")).post("/api/v1/workout/logs", { data: { bookingId: booking.id } })).status()).toBe(
      404,
    );
    const manager = await apiAs("FITNESS_MANAGER");
    const opened = await manager.post("/api/v1/workout/logs", { data: { bookingId: booking.id } });
    expect(opened.status()).toBe(201);
    const log = (await opened.json()) as { id: string };
    // Opening again gives the same log.
    const again = await (await apiAs("ADMIN")).post("/api/v1/workout/logs", { data: { bookingId: booking.id } });
    expect(((await again.json()) as { id: string }).id).toBe(log.id);

    // The PT neither reads nor writes the log of someone else's session.
    const pt = await apiAs("PT");
    expect((await pt.get(`/api/v1/workout/logs/${log.id}`)).status()).toBe(404);
    expect((await pt.put(`/api/v1/workout/logs/${log.id}`, { data: { items: [] } })).status()).toBe(404);
    const reception = await apiAs("RECEPTIONIST");
    expect((await reception.get(`/api/v1/workout/logs/${log.id}`)).status()).toBe(403);
    expect((await reception.put(`/api/v1/workout/logs/${log.id}`, { data: { items: [] } })).status()).toBe(403);
  });

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/workout/logs")).status()).toBe(401);
    expect((await anonymous.post("/api/v1/workout/logs", { data: {} })).status()).toBe(401);
    expect((await anonymous.put(`/api/v1/workout/logs/${randomUUID()}`, { data: {} })).status()).toBe(401);
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a script in a note is kept as text, and bad requests are 400 or 404", async ({ apiAs, testTag }) => {
    const booking = await session(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const log = (await (await admin.post("/api/v1/workout/logs", { data: { bookingId: booking.id } })).json()) as {
      id: string;
    };
    const script = `<script>alert(1)</script> ${testTag}`;
    const saved = await admin.put(`/api/v1/workout/logs/${log.id}`, {
      data: { coachNotes: script, goal: script, items: [] },
    });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ coachNotes: script, goal: script });

    for (const data of [
      {},
      { items: "x" },
      { items: [], preStress: 0 },
      { items: [], preEnergy: 11 },
      { items: [], postSrpe: 5.5 },
      { items: [], postEnergy: "abc" },
      { items: [], coachNotes: "a\u0007b" },
      { items: [], coachNotes: "x".repeat(2001) },
      { items: [], preImpactId: "nope" },
      { items: [], preImpactId: randomUUID() },
      { items: [{ exerciseId: randomUUID(), sets: [] }] },
      { items: [{ exerciseId: "nope", sets: [] }] },
    ]) {
      const response = await admin.put(`/api/v1/workout/logs/${log.id}`, { data });
      expect(response.status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    expect((await admin.put(`/api/v1/workout/logs/${randomUUID()}`, { data: { items: [] } })).status()).toBe(404);
    expect((await admin.get("/api/v1/workout/logs/not-a-uuid")).status()).toBe(404);
    for (const data of [{}, { bookingId: "nope" }]) {
      expect((await admin.post("/api/v1/workout/logs", { data })).status(), JSON.stringify(data)).toBe(400);
    }
    expect((await admin.post("/api/v1/workout/logs", { data: { bookingId: randomUUID() } })).status()).toBe(404);
    for (const query of ["pageSize=101", "page=0", "customerId=nope", "trainerId=nope"]) {
      expect((await admin.get(`/api/v1/workout/logs?${query}`)).status(), query).toBe(400);
    }
  });
});
