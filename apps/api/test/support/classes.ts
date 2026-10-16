import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { createContract } from "../../src/modules/contracts/contract.service.js";
import { activateContract } from "../../src/modules/contracts/contract-approval.service.js";
import { createService, saveTiers } from "../../src/modules/services/service.service.js";
import { createClass } from "../../src/modules/classes/class.service.js";
import { env } from "../../src/platform/env.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { CONTRACT_START, createTrainer, testSalesperson } from "./bookings.js";
import { DEFAULT_BRANCH_ID, createTestUser, uniquePhone } from "./factories.js";

/** The group-class service every class contract is sold under: 100,000 a session, valid for 60 months. */
export async function classService() {
  const existing = await prisma.service.findUnique({ where: { name: "Group Training" }, select: { id: true } });
  if (existing) return existing;
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const service = await createService(admin, { name: "Group Training", kind: "CLASS", branchIds: [DEFAULT_BRANCH_ID] });
  await saveTiers(admin, service.id, {
    effectiveFrom: "01/01/2020",
    tiers: [{ minSessions: 1, maxSessions: 1000, unitPrice: 100_000, validityMonths: 60, validityDays: 0 }],
  });
  return service;
}

/** A customer with an approved group-class contract of `sessions` sessions. */
export async function classCustomer(manager: Actor, options: { sessions?: number; fullName?: string } = {}) {
  const customer = await createCustomer(manager, {
    fullName: options.fullName ?? "Khách lớp nhóm",
    phone: uniquePhone(),
  });
  const service = await classService();
  const sale = await testSalesperson();
  const { contract } = await createContract(
    manager,
    customer.id,
    {
      serviceId: service.id,
      sessions: options.sessions ?? 12,
      contractDate: CONTRACT_START,
      startDate: CONTRACT_START,
      saleShares: [{ employeeId: sale.id, percent: 100 }],
    },
    randomUUID(),
  );
  const { actor: approver } = await createTestUser("ADMIN", { allBranches: true });
  return { customer, contract: await activateContract(approver, contract.id) };
}

/** Today in the gym as dd/MM/yyyy. */
export function gymTodayText(offsetDays = 0): string {
  const day = new Date(calendarDateInTimeZone(env.GYM_TIMEZONE).getTime() + offsetDays * 86_400_000);
  const [year, month, date] = day.toISOString().slice(0, 10).split("-");
  return `${date}/${month}/${year}`;
}

/**
 * A class that runs every day from a minute past midnight, so today's session has started and tomorrow's has not.
 * Returns the class and its coach.
 */
export async function everyDayClass(
  admin: Actor,
  coachMaker: Actor,
  options: { capacity?: number; name?: string; coachName?: string } = {},
) {
  const coach = await createTrainer(coachMaker, { fullName: options.coachName ?? "HLV Lớp" });
  const gymClass = await createClass(admin, {
    name: options.name ?? "Group Training 00:01",
    branchId: DEFAULT_BRANCH_ID,
    coachId: coach.id,
    capacity: options.capacity ?? 20,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startTime: "00:01",
    endTime: "00:59",
  });
  return { gymClass, coach };
}
