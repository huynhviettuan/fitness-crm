import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { activateContract, createContract } from "../../src/modules/contracts/contract.service.js";
import { createEmployee, replaceShifts } from "../../src/modules/employees/employee.service.js";
import { createBooking } from "../../src/modules/bookings/booking.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { DEFAULT_BRANCH_ID, actorOf, createTestUser } from "./factories.js";

/** The day the test contracts start and are priced; they run well past the dates the tests book. */
export const CONTRACT_START = "01/10/2026";

/**
 * The service every test contract is sold under: "PT", priced 500,000 a session for 1 to 1,000 sessions with a 60-month
 * validity, so a 24-session contract is "PT 24 buổi" worth 12,000,000 and runs until 2031 (M4.3). It is a member-kind
 * service, so no PT share is needed. `months` makes a shorter one for the tests that need an ended contract.
 */
export async function testService(months = 60, unitPrice = 500_000, serviceName?: string) {
  const name = serviceName ?? (months === 60 && unitPrice === 500_000 ? "PT" : `PT ${months}t ${unitPrice}`);
  const existing = await prisma.service.findUnique({ where: { name }, select: { id: true } });
  if (existing) return existing;
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const service = await createService(admin, { name, kind: "MEMBER", branchIds: [DEFAULT_BRANCH_ID] });
  await saveTiers(admin, service.id, {
    effectiveFrom: "01/01/2020",
    tiers: [{ minSessions: 1, maxSessions: 1000, unitPrice, validityMonths: months, validityDays: 0 }],
  });
  return service;
}

/** The salesperson every test contract names (A-115). */
export async function testSalesperson() {
  const existing = await prisma.employee.findFirst({ where: { fullName: "Nhân viên bán hàng" }, select: { id: true } });
  if (existing) return existing;
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  return createEmployee(admin, { fullName: "Nhân viên bán hàng", branchId: DEFAULT_BRANCH_ID });
}

/** The input of a contract that prices 24 sessions from `testService`; `overrides` win. */
export async function contractInput(
  overrides: Record<string, unknown> = {},
  options: { months?: number; unitPrice?: number; name?: string } = {},
) {
  const service = await testService(options.months, options.unitPrice, options.name);
  const sale = await testSalesperson();
  return {
    serviceId: service.id,
    sessions: 24,
    contractDate: CONTRACT_START,
    startDate: CONTRACT_START,
    saleShares: [{ employeeId: sale.id, percent: 100 }],
    ...overrides,
  };
}

export type Scenario = Awaited<ReturnType<typeof bookingScenario>>;

/** A manager, a customer with an active contract, and a trainer. Cleaned up by resetDatabase(). */
export async function bookingScenario(options: { sessions?: number; fullName?: string; phone?: string } = {}) {
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(manager, {
    fullName: options.fullName ?? "Nguyễn Văn An",
    phone: options.phone ?? "0909123456",
  });
  const contract = await activeContract(manager, customer.id, { sessions: options.sessions ?? 24 });
  const trainer = await createTrainer(manager, { fullName: "PT Minh" });
  return { manager, customer, contract, trainer };
}

/** A contract `actor` sells and an admin approves: nobody approves their own (D-018). */
export async function activeContract(
  actor: Actor,
  customerId: string,
  overrides: Record<string, unknown> = {},
  options: { months?: number; unitPrice?: number; name?: string } = {},
) {
  const { contract } = await createContract(actor, customerId, await contractInput(overrides, options), randomUUID());
  const { actor: approver } = await createTestUser("ADMIN", { allBranches: true });
  return activateContract(approver, contract.id);
}

/**
 * An employee who teaches PT and works every day around the clock, so the tests' slots
 * are inside working hours unless a test narrows them (D-030).
 */
export async function createTrainer(actor: Actor, input: { fullName: string; userId?: string }) {
  const trainer = await createEmployee(actor, { ...input, isTrainer: true });
  await replaceShifts(actor, trainer.id, {
    shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "24:00" })),
  });
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
export function book(
  actor: Actor,
  scenario: Pick<Scenario, "customer" | "contract" | "trainer">,
  slot: Slot = {},
  trainerId?: string,
) {
  return createBooking(actor, {
    customerId: scenario.customer.id,
    contractId: scenario.contract.id,
    trainerId: trainerId ?? scenario.trainer.id,
    date: slot.date ?? "15/10/2026",
    startTime: slot.startTime ?? "18:00",
    endTime: slot.endTime ?? "19:00",
  });
}
