import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { getBooking, listBookings } from "../../src/modules/bookings/booking.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import { burnShow, deleteTrainedSession } from "../../src/modules/sessions/session-history.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestUser, optionId } from "../support/factories.js";
import { book, bookingScenario, createTrainer, type Scenario } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});

// Delete from the check-in history and Burn Show (M5.4; brief §6.3; D-026, D-027, D-028, D-036; docs/13 E2E-109).

async function trainedSession(options: { sessions?: number } = {}) {
  const scenario = await bookingScenario(options);
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const booking = await book(scenario.manager, scenario, { date: "10/10/2026" });
  await completeSession(admin, booking.id);
  return { ...scenario, admin, booking };
}

const OTHER_DELETE = () => optionId("deleteReasons", "Khác");
const deletion = async (note = "Ghi nhầm buổi tập") => ({ reasonId: await OTHER_DELETE(), reasonNote: note });
const burnInput = async (
  scenario: Pick<Scenario, "contract" | "trainer">,
  overrides: Record<string, unknown> = {},
) => ({
  contractId: scenario.contract.id,
  trainerId: scenario.trainer.id,
  date: "10/10/2026",
  startTime: "09:00",
  endTime: "10:00",
  reasonId: await optionId("burnShowReasons", "Khôi phục buổi tập xóa nhầm"),
  ...overrides,
});

const left = async (scenario: Pick<Scenario, "manager" | "contract">) =>
  (await getContract(scenario.manager, scenario.contract.id)).remainingSessions;
const emails = (customerId: string, event: string) =>
  prisma.emailMessage.findMany({ where: { personId: customerId, event } });

describe("deleteTrainedSession (D-026, BR-406)", () => {
  it("refunds one session, removes the PT credit, moves the booking to the trash, and emails the customer", async () => {
    const scenario = await trainedSession();
    const { admin, booking, customer, contract } = scenario;
    expect(await left(scenario)).toBe(23);

    await deleteTrainedSession(admin, booking.id, await deletion());

    expect(await left(scenario)).toBe(24);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
      status: "DELETED",
      consumes: false,
      creditsPt: false,
      historyDeletedById: admin.id,
    });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).historyDeletedAt).toBeInstanceOf(
      Date,
    );
    expect(await prisma.trashEntry.findFirst({ where: { entityId: booking.id } })).toMatchObject({
      entityType: "booking",
      reasonNote: "Ghi nhầm buổi tập",
      deletedById: admin.id,
    });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: booking.id, action: "booking.history_deleted" } }),
    ).toMatchObject({
      actorUserId: admin.id,
    });
    const [email] = await emails(customer.id, "session.refunded");
    expect(email).toMatchObject({ dedupeKey: `session.refunded:${booking.id}`, locale: "vi" });
    expect(email?.subject).toContain(contract.contractCode);
    expect(email?.body).toContain("Số buổi còn lại: 24");
    // A deleted session is in the trash, not in any list.
    expect((await listBookings(admin, {})).items.map((item) => item.id)).not.toContain(booking.id);
    await expect(getBooking(admin, booking.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("frees the slot, so the same hour can be booked again", async () => {
    const scenario = await trainedSession();
    await deleteTrainedSession(scenario.admin, scenario.booking.id, await deletion());
    await expect(book(scenario.manager, scenario, { date: "10/10/2026" })).resolves.toMatchObject({ status: "BOOKED" });
  });

  it("is for a trained session only: Booked, cancelled, no-show and already deleted are refused", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const booked = await book(scenario.manager, scenario, { date: "10/10/2026" });

    await expect(deleteTrainedSession(admin, booked.id, await deletion())).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    expect(await left(scenario)).toBe(24);
  });

  it("is Admin's: the manager, reception and the PT cannot", async () => {
    const scenario = await trainedSession();
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(deleteTrainedSession(actor, scenario.booking.id, await deletion())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(await left(scenario)).toBe(23);
  });

  it("needs a reason from the list, and a note for Khác", async () => {
    const scenario = await trainedSession();
    const { admin, booking } = scenario;

    await expect(deleteTrainedSession(admin, booking.id, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      deleteTrainedSession(admin, booking.id, { reasonId: await OTHER_DELETE(), reasonNote: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { reasonNote: ["otherNeedsNote"] } });
    // A reason of another list is not a delete reason.
    await expect(
      deleteTrainedSession(admin, booking.id, { reasonId: await optionId("burnShowReasons", "Khác"), reasonNote: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await left(scenario)).toBe(23);
  });

  it("refunds once when repeated or sent many times at once, with one email (BR-007)", async () => {
    const scenario = await trainedSession();
    const { admin, booking, customer } = scenario;
    const input = await deletion();

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => deleteTrainedSession(admin, booking.id, input)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    // Once deleted the booking is out of sight, so a repeat is not found.
    for (const result of results) {
      if (result.status === "rejected")
        expect(["NOT_FOUND", "INVALID_STATUS_TRANSITION"]).toContain(result.reason.code);
    }
    expect(await left(scenario)).toBe(24);
    expect(await emails(customer.id, "session.refunded")).toHaveLength(1);
    expect(await prisma.trashEntry.count({ where: { entityId: booking.id } })).toBe(1);
  });

  it("keeps the other sessions of the contract as they were", async () => {
    const scenario = await trainedSession();
    const second = await book(scenario.manager, scenario, { date: "11/10/2026" });
    await completeSession(scenario.admin, second.id);
    expect(await left(scenario)).toBe(22);

    await deleteTrainedSession(scenario.admin, scenario.booking.id, await deletion());

    expect(await left(scenario)).toBe(23);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: "TRAINED",
      consumes: true,
      creditsPt: true,
    });
  });
});

describe("burnShow (D-028, BR-408)", () => {
  it("adds a trained session by hand: it consumes, credits the PT, is marked, audited, and emailed", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });

    const burned = await burnShow(admin, await burnInput(scenario));

    expect(burned).toMatchObject({
      status: "TRAINED",
      consumes: true,
      creditsPt: true,
      addedByHand: true,
      checkedIn: true,
      session: { confirmationMethod: "MANUAL", completedBy: admin.name },
      customer: { id: scenario.customer.id },
      trainer: { id: scenario.trainer.id },
    });
    expect(await left(scenario)).toBe(23);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: burned.id } });
    expect(row).toMatchObject({ addedByHand: true, branchId: scenario.contract.branch.id, statusSetById: admin.id });
    expect(row.scheduledStart.toISOString()).toBe("2026-10-10T02:00:00.000Z");
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: burned.id, action: "booking.burn_show" } });
    expect(audit).toMatchObject({ actorUserId: admin.id });
    const [email] = await emails(scenario.customer.id, "session.added");
    expect(email).toMatchObject({ dedupeKey: `session.added:${burned.id}` });
    expect(email?.body).toContain("Số buổi còn lại: 23");
  });

  it("restores a session that was deleted by mistake", async () => {
    const scenario = await trainedSession();
    await deleteTrainedSession(scenario.admin, scenario.booking.id, await deletion());
    expect(await left(scenario)).toBe(24);

    await burnShow(scenario.admin, await burnInput(scenario, { startTime: "18:00", endTime: "19:00" }));

    expect(await left(scenario)).toBe(23);
  });

  it("is Admin's, and needs a reason from its list, with a note for Khác", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(burnShow(actor, await burnInput(scenario))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const other = await optionId("burnShowReasons", "Khác");
    await expect(burnShow(admin, await burnInput(scenario, { reasonId: other }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { reasonNote: ["otherNeedsNote"] },
    });
    await expect(
      burnShow(admin, await burnInput(scenario, { reasonId: await OTHER_DELETE(), reasonNote: "x" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      burnShow(admin, await burnInput(scenario, { reasonId: other, reasonNote: "Quên quét" })),
    ).resolves.toMatchObject({
      addedByHand: true,
    });
    expect(await left(scenario)).toBe(23);
  });

  it("follows the rules of a booking: the contract's days, the trainer, the customer, and the future", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const rival = await createTrainer(scenario.manager, { fullName: "PT Hoa" });
    await burnShow(admin, await burnInput(scenario));

    // Before the contract started (01/10/2026).
    await expect(burnShow(admin, await burnInput(scenario, { date: "20/09/2026" }))).rejects.toMatchObject({
      code: "BOOKING_OUTSIDE_CONTRACT_PERIOD",
    });
    // The same trainer, and the same customer with another trainer, at an overlapping time.
    await expect(
      burnShow(admin, await burnInput(scenario, { startTime: "09:30", endTime: "10:30" })),
    ).rejects.toMatchObject({
      code: "BOOKING_TRAINER_OVERLAP",
    });
    await expect(
      burnShow(admin, await burnInput(scenario, { trainerId: rival.id, startTime: "09:30", endTime: "10:30" })),
    ).rejects.toMatchObject({ code: "BOOKING_CUSTOMER_OVERLAP" });
    // Not yet happened.
    await expect(burnShow(admin, await burnInput(scenario, { date: "01/01/2099" }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { date: ["futureDate"] },
    });
    // The end must be after the start; an unknown or unseen contract is not found.
    await expect(burnShow(admin, await burnInput(scenario, { endTime: "08:00" }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(burnShow(admin, await burnInput(scenario, { contractId: crypto.randomUUID() }))).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(await left(scenario)).toBe(23);
  });

  it("needs a session left on the contract", async () => {
    const scenario = await bookingScenario({ sessions: 1 });
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    await burnShow(admin, await burnInput(scenario));

    await expect(
      burnShow(admin, await burnInput(scenario, { startTime: "12:00", endTime: "13:00" })),
    ).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });
    expect(await left(scenario)).toBe(0);
  });

  it("consumes exactly one session when the last one is burned twice at once", async () => {
    const scenario = await bookingScenario({ sessions: 1 });
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const input = await burnInput(scenario);

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => burnShow(admin, input)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await left(scenario)).toBe(0);
    expect(await prisma.booking.count({ where: { addedByHand: true } })).toBe(1);
    expect(await emails(scenario.customer.id, "session.added")).toHaveLength(1);
  });

  it("cannot reach a contract of a branch the admin does not work in", async () => {
    const scenario = await bookingScenario();
    const elsewhere = await createTestBranch();
    const { actor: stranger } = await createTestUser("ADMIN", { branchIds: [elsewhere.id] });
    await expect(burnShow(stranger, await burnInput(scenario))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
