import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  activateContract,
  cancelContract,
  createContract,
  getContract,
  listContracts,
  updateContract,
} from "../../src/modules/contracts/contract.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser } from "../support/factories.js";
import { activeContract, book, bookingScenario } from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});

const pt24 = { packageName: "PT 24 buổi", contractValue: "12.000.000", totalSessions: "24", startDate: "01/10/2026", endDate: "31/03/2027" };

async function setup() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  return { reception, customer };
}

function create(actor: Actor, customerId: string, input: object = pt24, key = randomUUID()) {
  return createContract(actor, customerId, input, key);
}

describe("createContract", () => {
  it("creates a DRAFT with a generated code, derived figures, and an audit event", async () => {
    const { reception, customer } = await setup();

    const { contract, replayed } = await create(reception, customer.id);

    expect(replayed).toBe(false);
    expect(contract).toMatchObject({
      contractCode: expect.stringMatching(/^HD\d{6,}$/),
      status: "DRAFT",
      customer: { id: customer.id, customerCode: customer.customerCode },
      totalSessions: 24,
      completedSessions: 0,
      remainingSessions: 24,
      contractValue: 12_000_000,
      paidAmount: 0,
      debt: 12_000_000,
    });
    const audit = await prisma.auditEvent.findMany({ where: { entityId: contract.id } });
    expect(audit).toEqual([expect.objectContaining({ action: "contract.created", actorUserId: reception.id })]);
  });

  it("gives contracts created at the same time different codes (T-019)", async () => {
    const { reception, customer } = await setup();

    const results = await Promise.all(Array.from({ length: 8 }, () => create(reception, customer.id)));

    expect(new Set(results.map((r) => r.contract.contractCode)).size).toBe(8);
  });

  it.each(["TRAINER", "ACCOUNTANT"] as const)("refuses a %s (docs/09)", async (role) => {
    const { customer } = await setup();
    const { actor } = await createTestUser(role);

    await expect(create(actor, customer.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unknown customer", async () => {
    const { reception } = await setup();

    await expect(create(reception, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns field errors and saves nothing for invalid input", async () => {
    const { reception, customer } = await setup();

    await expect(create(reception, customer.id, { ...pt24, contractValue: "12.5", endDate: "01/01/2026" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { contractValue: ["invalidAmount"] },
    });
    expect(await prisma.contract.count()).toBe(0);
  });
});

describe("duplicate submission (T-015)", () => {
  it("requires an idempotency key", async () => {
    const { reception, customer } = await setup();

    for (const key of [undefined, "", "not-a-uuid"]) {
      await expect(createContract(reception, customer.id, pt24, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
  });

  it("a replay with the same key returns the original and creates nothing new", async () => {
    const { reception, customer } = await setup();
    const key = randomUUID();

    const first = await create(reception, customer.id, pt24, key);
    const second = await create(reception, customer.id, pt24, key);

    expect(second).toEqual({ contract: first.contract, replayed: true });
    expect(await prisma.contract.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "contract.created" } })).toBe(1);
  });

  it("the same key with different content is refused", async () => {
    const { reception, customer } = await setup();
    const key = randomUUID();
    await create(reception, customer.id, pt24, key);

    await expect(create(reception, customer.id, { ...pt24, totalSessions: "12" }, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("a double-click (same key sent at the same time) creates one contract", async () => {
    const { reception, customer } = await setup();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => create(reception, customer.id, pt24, key)));

    expect(new Set(results.map((r) => r.contract.id)).size).toBe(1);
    expect(await prisma.contract.count()).toBe(1);
  });
});

describe("status changes", () => {
  it("activates a draft once, and a repeat changes nothing", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);

    expect((await activateContract(reception, contract.id)).status).toBe("ACTIVE");
    expect((await activateContract(reception, contract.id)).status).toBe("ACTIVE");

    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.activated" } })).toBe(1);
  });

  it("concurrent activations record exactly one transition", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);

    await Promise.all(Array.from({ length: 5 }, () => activateContract(reception, contract.id)));

    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.activated" } })).toBe(1);
  });

  it("only Admin and Manager can cancel (A-015)", async () => {
    const { reception, customer } = await setup();
    const { actor: manager } = await createTestUser("MANAGER");
    const { contract } = await create(reception, customer.id);
    await activateContract(reception, contract.id);

    await expect(cancelContract(reception, contract.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await cancelContract(manager, contract.id)).status).toBe("CANCELLED");
    expect((await cancelContract(manager, contract.id)).status).toBe("CANCELLED");
    await expect(activateContract(reception, contract.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("an expired contract cannot be cancelled", async () => {
    const { reception, customer } = await setup();
    const { actor: manager } = await createTestUser("MANAGER");
    const { contract } = await create(reception, customer.id, { ...pt24, startDate: "01/01/2025", endDate: "31/12/2025" });
    expect((await activateContract(reception, contract.id)).status).toBe("EXPIRED");

    await expect(cancelContract(manager, contract.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });
});

describe("editing (OQ-015 interim: drafts only)", () => {
  it("a draft can be edited, and the change is audited", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);

    const updated = await updateContract(reception, contract.id, { ...pt24, totalSessions: "12", contractValue: "6.000.000" });

    expect(updated).toMatchObject({ totalSessions: 12, contractValue: 6_000_000, contractCode: contract.contractCode });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: contract.id, action: "contract.updated" } });
    expect(audit.metadata).toEqual({
      changes: { contractValue: { from: "12000000", to: "6000000" }, totalSessions: { from: 24, to: 12 } },
    });
  });

  it("an active contract cannot be edited", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);
    await activateContract(reception, contract.id);

    await expect(updateContract(reception, contract.id, { ...pt24, totalSessions: "48" })).rejects.toMatchObject({
      code: "CONTRACT_NOT_EDITABLE",
    });
  });
});

describe("reading", () => {
  it("counts opening balances of an imported contract (D-011)", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);
    // Set as the import tool will (OQ-014): directly, once.
    await prisma.contract.update({ where: { id: contract.id }, data: { openingSessionsUsed: 8, openingPaidAmount: 5_000_000 } });

    expect(await getContract(reception, contract.id)).toMatchObject({
      remainingSessions: 16,
      openingPaidAmount: 5_000_000,
      paidAmount: 5_000_000,
      debt: 7_000_000,
    });
  });

  it("reports EXPIRED from the end date and the gym's clock, with no job (INT-008)", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id, { ...pt24, startDate: "01/10/2026", endDate: "10/10/2026" });
    await activateContract(reception, contract.id);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T16:59:00Z")); // 23:59 in the gym
    expect((await getContract(reception, contract.id)).status).toBe("ACTIVE");
    vi.setSystemTime(new Date("2026-10-10T17:00:00Z")); // 00:00 the next day
    expect((await getContract(reception, contract.id)).status).toBe("EXPIRED");
  });

  it("a trainer sees no contracts until bookings exist (OQ-006 interim)", async () => {
    const { reception, customer } = await setup();
    const { actor: trainer } = await createTestUser("TRAINER");
    const { contract } = await create(reception, customer.id);

    expect((await listContracts(trainer, {})).total).toBe(0);
    await expect(getContract(trainer, contract.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("searches by contract code, package, and customer name without accents", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);
    const other = await createCustomer(reception, { fullName: "Lê Thị Hoa", phone: "0388777666" });
    await create(reception, other.id, { ...pt24, packageName: "Yoga 12 buổi" });

    for (const q of [contract.contractCode.toLowerCase(), "pt 24", "nguyen van"]) {
      expect((await listContracts(reception, { q })).items.map((c) => c.id), q).toEqual([contract.id]);
    }
  });

  it("the database itself refuses impossible contracts", async () => {
    const { reception, customer } = await setup();
    const { contract } = await create(reception, customer.id);

    await expect(prisma.contract.update({ where: { id: contract.id }, data: { totalSessions: 0 } })).rejects.toThrow();
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { openingSessionsUsed: 25 } })).rejects.toThrow();
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { contractValue: -1 } })).rejects.toThrow();
  });
});

describe("cancelling a contract with bookings (D-010, BR-017)", () => {
  it("cancels every BOOKED booking with an audit event each, and leaves finished ones alone", async () => {
    const scenario = await bookingScenario();
    const future = await book(scenario.manager, scenario, { date: "20/10/2026", startTime: "08:00", endTime: "09:00" });
    const past = await book(scenario.manager, scenario, { date: "02/10/2026", startTime: "08:00", endTime: "09:00" });
    const completed = await book(scenario.manager, scenario, { date: "03/10/2026", startTime: "08:00", endTime: "09:00" });
    await checkIn(scenario.manager, completed.id);
    await completeSession(scenario.manager, completed.id);

    const cancelled = await cancelContract(scenario.manager, scenario.contract.id);

    expect(cancelled).toMatchObject({ status: "CANCELLED", completedSessions: 1 });
    const statuses = await prisma.booking.findMany({ select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((b) => [b.id, b.status]))).toEqual({
      [future.id]: "CANCELLED",
      [past.id]: "CANCELLED",
      [completed.id]: "COMPLETED",
    });
    const audits = await prisma.auditEvent.findMany({ where: { action: "booking.cancelled" } });
    expect(audits.map((a) => a.entityId).sort()).toEqual([future.id, past.id].sort());
    expect(audits[0].metadata).toMatchObject({ reason: "contract.cancelled", contractId: scenario.contract.id });
    // The trainer's time is free again (A-005).
    await expect(createTrainerBooking(scenario, "20/10/2026")).resolves.toBeDefined();
  });

  it("is refused while a booking is checked in, and nothing changes", async () => {
    const scenario = await bookingScenario();
    const checkedIn = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const booked = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await checkIn(scenario.manager, checkedIn.id);

    await expect(cancelContract(scenario.manager, scenario.contract.id)).rejects.toMatchObject({
      code: "CONTRACT_HAS_CHECKED_IN_BOOKING",
    });
    expect((await getContract(scenario.manager, scenario.contract.id)).status).toBe("ACTIVE");
    expect((await prisma.booking.findUnique({ where: { id: booked.id } }))?.status).toBe("BOOKED");
  });

  it("a check-in racing the cancellation never leaves a checked-in booking on a cancelled contract", async () => {
    for (let round = 0; round < 5; round++) {
      const scenario = await bookingScenario({ phone: `09090000${round}0` });
      const booking = await book(scenario.manager, scenario);

      await Promise.allSettled([cancelContract(scenario.manager, scenario.contract.id), checkIn(scenario.manager, booking.id)]);

      const contract = await getContract(scenario.manager, scenario.contract.id);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (contract.status === "CANCELLED") expect(after.status).toBe("CANCELLED");
      else expect(after.status).toBe("CHECKED_IN");
    }
  });
});

/** Another booking for the scenario's trainer at 08:00–09:00 on `date`, on a new contract. */
async function createTrainerBooking(scenario: Awaited<ReturnType<typeof bookingScenario>>, date: string) {
  const contract = await activeContract(scenario.manager, scenario.customer.id);
  return book(scenario.manager, { ...scenario, contract }, { date, startTime: "08:00", endTime: "09:00" });
}
