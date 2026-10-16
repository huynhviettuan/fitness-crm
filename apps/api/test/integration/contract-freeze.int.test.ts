import { afterEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@gymcrm/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { cancelBooking, listBookings, markNoShow } from "../../src/modules/bookings/booking.service.js";
import { getCustomer } from "../../src/modules/customers/customer.service.js";
import { cancelContract, getContract } from "../../src/modules/contracts/contract.service.js";
import {
  deactivateContract,
  reactivateContract,
  remindLongFreezes,
} from "../../src/modules/contracts/contract-freeze.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestOption, createTestUser, optionId } from "../support/factories.js";
import { book, bookingScenario } from "../support/bookings.js";

afterEach(resetDatabase);

const FREEZE = await optionId("freezeReasons", "Khác");
const UNFREEZE = await optionId("unfreezeReasons", "Khác");
const DAY = 86_400_000;

const why = (reasonId: string) => ({ reasonId, reasonNote: "Nghi sai phạm" });
const reactivation = (extension: "ALL" | "CUSTOM" | "NONE", days?: string) => ({
  ...why(UNFREEZE),
  extension,
  days,
});

async function frozen() {
  const scenario = await bookingScenario();
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const contract = await deactivateContract(admin, scenario.contract.id, why(FREEZE));
  return { ...scenario, admin, frozenContract: contract };
}

/** Pretends the freeze began `days` ago, as the clock itself cannot be moved. */
async function frozenFor(contractId: string, days: number) {
  const open = await prisma.contractFreeze.findFirstOrThrow({ where: { contractId, endedAt: null } });
  await prisma.contractFreeze.update({
    where: { id: open.id },
    data: {
      frozenOn: new Date(open.frozenOn.getTime() - days * DAY),
      frozenAt: new Date(open.frozenAt.getTime() - days * DAY),
    },
  });
}

describe("deactivating a contract (D-023)", () => {
  it("is Admin's, needs a reason, and locks a running contract", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });

    await expect(deactivateContract(scenario.manager, scenario.contract.id, why(FREEZE))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(deactivateContract(admin, scenario.contract.id, {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const contract = await deactivateContract(admin, scenario.contract.id, why(FREEZE));

    expect(contract).toMatchObject({
      status: "FROZEN",
      freeze: { frozenDays: 0, frozenBy: { id: admin.id }, reason: { note: "Nghi sai phạm" } },
    });
    expect(contract.freeze!.proposedEndDate).toEqual(contract.endDate);
    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.deactivated" } })).toBe(1);
  });

  it("repeating it changes nothing, and only a running contract can be deactivated", async () => {
    const { admin, contract, manager } = await frozen();

    await deactivateContract(admin, contract.id, why(FREEZE));
    expect(await prisma.contractFreeze.count({ where: { contractId: contract.id } })).toBe(1);

    const other = await bookingScenario({ fullName: "Khách Hai", phone: "0909000022" });
    await cancelContract(manager, other.contract.id);
    await expect(deactivateContract(admin, other.contract.id, why(FREEZE))).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("two requests at once make one freeze", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });

    await Promise.all(Array.from({ length: 5 }, () => deactivateContract(admin, scenario.contract.id, why(FREEZE))));

    expect(await prisma.contractFreeze.count({ where: { contractId: scenario.contract.id } })).toBe(1);
  });

  it("locks the sale as any approved contract is, also in the database", async () => {
    const { contract } = await frozen();

    await expect(prisma.contract.update({ where: { id: contract.id }, data: { contractValue: 1 } })).rejects.toThrow(
      /locked after approval/,
    );
    await prisma.contract.update({ where: { id: contract.id }, data: { notes: "Đang xem xét" } });
  });
});

describe("while a contract is deactivated (AC-14)", () => {
  it("it cannot be booked, rescheduled to, checked in, completed, or marked no-show", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const booked = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const checked = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await checkIn(scenario.manager, checked.id);
    await deactivateContract(admin, scenario.contract.id, why(FREEZE));

    await expect(book(scenario.manager, scenario, { startTime: "12:00", endTime: "13:00" })).rejects.toMatchObject({
      code: "CONTRACT_FROZEN",
    });
    await expect(checkIn(scenario.manager, booked.id)).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
    await expect(markNoShow(scenario.manager, booked.id)).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
    await expect(completeSession(scenario.manager, checked.id)).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
    expect((await getContract(scenario.manager, scenario.contract.id)).completedSessions).toBe(0);
  });

  it("its booked sessions stay and show as belonging to a deactivated contract; admin can cancel them", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const booked = await book(scenario.manager, scenario);
    expect(booked.contract.frozen).toBe(false);
    await deactivateContract(admin, scenario.contract.id, why(FREEZE));

    const [row] = (await listBookings(admin, { contractId: scenario.contract.id })).items;
    expect(row).toMatchObject({ id: booked.id, status: "BOOKED", contract: { frozen: true } });
    expect((await cancelBooking(admin, booked.id)).status).toBe("CANCELLED");
  });

  it("does not expire, however late the end date is", async () => {
    const { contract, manager } = await frozen();
    await prisma.contract.update({ where: { id: contract.id }, data: { endDate: new Date("2026-10-01") } });

    expect((await getContract(manager, contract.id)).status).toBe("FROZEN");
  });

  it("an active contract past its end date is expired, the end day itself still counting (INT-008, T-018)", async () => {
    const scenario = await bookingScenario();
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    const today = new Date(`${day}T00:00:00Z`);
    await prisma.contract.update({ where: { id: scenario.contract.id }, data: { endDate: today } });
    expect((await getContract(scenario.manager, scenario.contract.id)).status).toBe("ACTIVE");

    await prisma.contract.update({
      where: { id: scenario.contract.id },
      data: { endDate: new Date(today.getTime() - DAY) },
    });
    expect((await getContract(scenario.manager, scenario.contract.id)).status).toBe("EXPIRED");
  });

  it("the customer is still training", async () => {
    const { customer, manager } = await frozen();

    expect((await getCustomer(manager, customer.id)).contractStatus).toBe("TRAINING");
  });
});

describe("reactivating a contract (D-023, brief §5.5)", () => {
  it("shows the frozen days and the proposed end date", async () => {
    const { contract, admin } = await frozen();
    await frozenFor(contract.id, 10);

    const view = await getContract(admin, contract.id);

    expect(view.freeze).toMatchObject({ frozenDays: 10 });
    expect(view.freeze!.proposedEndDate.getTime()).toBe(view.endDate.getTime() + 10 * DAY);
  });

  it("adds all the frozen days, a number of days, or none, with a reason", async () => {
    for (const [extension, days, added] of [
      ["ALL", undefined, 10],
      ["CUSTOM", "4", 4],
      ["NONE", undefined, 0],
    ] as const) {
      const { contract, admin } = await frozen();
      await frozenFor(contract.id, 10);

      const after = await reactivateContract(admin, contract.id, reactivation(extension, days));

      expect(after.status).toBe("ACTIVE");
      expect(after.endDate.getTime()).toBe(contract.endDate.getTime() + added * DAY);
      expect(await prisma.contractFreeze.findFirstOrThrow({ where: { contractId: contract.id } })).toMatchObject({
        frozenDays: 10,
        addedDays: added,
        endReasonNote: "Nghi sai phạm",
      });
      await resetDatabase();
    }
  });

  it("needs a reason, the days for a custom extension, and Admin", async () => {
    const { contract, admin, manager } = await frozen();

    await expect(reactivateContract(manager, contract.id, reactivation("NONE"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reactivateContract(admin, contract.id, { extension: "NONE" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(reactivateContract(admin, contract.id, reactivation("CUSTOM"))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { days: ["required"] },
    });
    expect((await getContract(admin, contract.id)).status).toBe("FROZEN");
  });

  it("changes the end date once, also when sent many times at once (INT-012)", async () => {
    const { contract, admin } = await frozen();
    await frozenFor(contract.id, 10);

    await Promise.all(Array.from({ length: 5 }, () => reactivateContract(admin, contract.id, reactivation("ALL"))));

    const after = await getContract(admin, contract.id);
    expect(after.endDate.getTime()).toBe(contract.endDate.getTime() + 10 * DAY);
    expect(await prisma.auditEvent.count({ where: { entityId: contract.id, action: "contract.reactivated" } })).toBe(1);
    // A reactivation of a contract that is not frozen changes nothing.
    await reactivateContract(admin, contract.id, reactivation("ALL"));
    expect((await getContract(admin, contract.id)).endDate).toEqual(after.endDate);
  });

  it("books again once reactivated, and each new freeze is its own record", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    await deactivateContract(admin, scenario.contract.id, why(FREEZE));
    await reactivateContract(admin, scenario.contract.id, reactivation("NONE"));

    expect((await book(scenario.manager, scenario)).status).toBe("BOOKED");
    await deactivateContract(admin, scenario.contract.id, why(FREEZE));
    expect(await prisma.contractFreeze.count({ where: { contractId: scenario.contract.id } })).toBe(2);
  });

  it("cancelling a frozen contract ends its freeze without adding days", async () => {
    const { contract, admin } = await frozen();
    await frozenFor(contract.id, 3);

    await cancelContract(admin, contract.id);

    expect(await prisma.contractFreeze.findFirstOrThrow({ where: { contractId: contract.id } })).toMatchObject({
      frozenDays: 3,
      addedDays: 0,
    });
  });
});

describe("the reminder after a long freeze (D-023)", () => {
  it("tells whoever may reactivate it, and makes a task for the manager department, once", async () => {
    const { contract, admin } = await frozen();
    const manager = await createTestOption("departments", "Quản lý");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, managerDepartmentId: manager });
    await frozenFor(contract.id, 11);

    expect(await remindLongFreezes()).toBe(1);

    expect(
      await prisma.notification.findMany({ where: { userId: admin.id, kind: "contractFrozenLong" } }),
    ).toHaveLength(1);
    expect(await prisma.task.findMany({ where: { entityId: contract.id } })).toEqual([
      expect.objectContaining({ entityType: "contract", assigneeDepartmentId: manager }),
    ]);
    expect(await remindLongFreezes()).toBe(0);
  });

  it("waits for the parameter's days, and makes no task without a department", async () => {
    const { contract, admin } = await frozen();
    await frozenFor(contract.id, 9);
    expect(await remindLongFreezes()).toBe(0);

    await frozenFor(contract.id, 2);
    expect(await remindLongFreezes()).toBe(1);
    expect(await prisma.task.count({ where: { entityId: contract.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: admin.id, kind: "contractFrozenLong" } })).toBe(1);
  });

  it("does not remind about a freeze that ended", async () => {
    const { contract, admin } = await frozen();
    await frozenFor(contract.id, 20);
    await reactivateContract(admin, contract.id, reactivation("NONE"));

    expect(await remindLongFreezes()).toBe(0);
  });
});
