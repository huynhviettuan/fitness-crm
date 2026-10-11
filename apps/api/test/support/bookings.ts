import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { activateContract, createContract } from "../../src/modules/contracts/contract.service.js";
import { createEmployee, replaceShifts } from "../../src/modules/employees/employee.service.js";
import { createBooking } from "../../src/modules/bookings/booking.service.js";
import { actorOf, createTestUser } from "./factories.js";

/** An active contract running until 2030, so booking dates in the tests stay valid. */
export const CONTRACT = {
  packageName: "PT 24 buổi",
  contractValue: "12.000.000",
  totalSessions: "24",
  startDate: "01/10/2026",
  endDate: "31/12/2030",
};

export type Scenario = Awaited<ReturnType<typeof bookingScenario>>;

/** A manager, a customer with an active contract, and a trainer. Cleaned up by resetDatabase(). */
export async function bookingScenario(options: { totalSessions?: number; fullName?: string; phone?: string } = {}) {
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(manager, {
    fullName: options.fullName ?? "Nguyễn Văn An",
    phone: options.phone ?? "0909123456",
  });
  const contract = await activeContract(manager, customer.id, { totalSessions: String(options.totalSessions ?? 24) });
  const trainer = await createTrainer(manager, { fullName: "PT Minh" });
  return { manager, customer, contract, trainer };
}

/** A contract `actor` sells and an admin approves: nobody approves their own (D-018). */
export async function activeContract(actor: Actor, customerId: string, overrides: Partial<typeof CONTRACT> = {}) {
  const { contract } = await createContract(actor, customerId, { ...CONTRACT, ...overrides }, randomUUID());
  const { actor: approver } = await createTestUser("ADMIN", { allBranches: true });
  return activateContract(approver, contract.id);
}

/**
 * An employee who teaches PT and works every day around the clock, so the tests' slots
 * are inside working hours unless a test narrows them (D-030).
 */
export async function createTrainer(actor: Actor, input: { fullName: string; userId?: string }) {
  const trainer = await createEmployee(actor, { ...input, isTrainer: true });
  await replaceShifts(actor, trainer.id, { shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "24:00" })) });
  return trainer;
}

/** A PT login and the trainer employee it belongs to, as the API sees it after the link. */
export async function linkedTrainer(manager: Actor, fullName = "PT Linh") {
  const { user } = await createTestUser("PT");
  const trainer = await createTrainer(manager, { fullName, userId: user.id });
  return { actor: await actorOf(user.id), trainer };
}

type Slot = { date?: string; startTime?: string; endTime?: string };

/** Books the scenario's customer and contract with `trainerId` (default: the scenario's trainer). */
export function book(actor: Actor, scenario: Pick<Scenario, "customer" | "contract" | "trainer">, slot: Slot = {}, trainerId?: string) {
  return createBooking(actor, {
    customerId: scenario.customer.id,
    contractId: scenario.contract.id,
    trainerId: trainerId ?? scenario.trainer.id,
    date: slot.date ?? "15/10/2026",
    startTime: slot.startTime ?? "18:00",
    endTime: slot.endTime ?? "19:00",
  });
}
