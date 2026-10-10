import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { activateContract, createContract } from "../../src/modules/contracts/contract.service.js";
import { createTrainer } from "../../src/modules/trainers/trainer.service.js";
import { createBooking } from "../../src/modules/bookings/booking.service.js";
import { createTestUser } from "./factories.js";

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
  const { actor: manager } = await createTestUser("MANAGER");
  const customer = await createCustomer(manager, {
    fullName: options.fullName ?? "Nguyễn Văn An",
    phone: options.phone ?? "0909123456",
  });
  const contract = await activeContract(manager, customer.id, { totalSessions: String(options.totalSessions ?? 24) });
  const trainer = await createTrainer(manager, { fullName: "PT Minh" });
  return { manager, customer, contract, trainer };
}

export async function activeContract(actor: Actor, customerId: string, overrides: Partial<typeof CONTRACT> = {}) {
  const { contract } = await createContract(actor, customerId, { ...CONTRACT, ...overrides }, randomUUID());
  return activateContract(actor, contract.id);
}

/** A trainer login linked to a new trainer record (A-010). */
export async function linkedTrainer(manager: Actor, fullName = "PT Linh") {
  const { actor } = await createTestUser("TRAINER");
  const trainer = await createTrainer(manager, { fullName, userId: actor.id });
  return { actor, trainer };
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
