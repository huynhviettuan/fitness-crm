import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@gymcrm/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import { showLead } from "../../src/modules/leads/lead-outcome.service.js";
import { markNoShow } from "../../src/modules/bookings/booking.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { addDayOff, replaceShifts } from "../../src/modules/employees/employee.service.js";
import { updateService } from "../../src/modules/services/service.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import { burnShow, deleteTrainedSession } from "../../src/modules/sessions/session-history.service.js";
import { enrollCustomer, markAttendance } from "../../src/modules/classes/class.service.js";
import { bookingReport, overview, ptRevenueReport } from "../../src/modules/reports/pt-report.service.js";
import { bookingReportExport, ptRevenueExport } from "../../src/modules/reports/pt-report.export.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestUser,
  optionId,
  roleId,
  uniquePhone,
  withoutApprovals,
  type RoleCode,
} from "../support/factories.js";
import { activeContract, book, bookingScenario, createTrainer, type Scenario } from "../support/bookings.js";
import { classCustomer, everyDayClass, gymTodayText } from "../support/classes.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

// The PT revenue allocation report, the booking report, and the overview dashboard (M5.6; brief §6.5, §9; D-032,
// D-058, D-027; A-166 to A-172).

const OCTOBER = { from: "01/10/2026", to: "31/10/2026" };
const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const BURN_REASON = await optionId("burnShowReasons", "Khôi phục buổi tập xóa nhầm");
const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const CASH = await optionId("paymentMethods", "Tiền mặt");

async function admin() {
  return (await createTestUser("ADMIN", { allBranches: true })).actor;
}

/** A role like the admin's with `masks` hidden and, optionally, the schedule's data scope reduced to "own". */
async function restrictedAdmin(options: { masks?: string[]; ownSchedule?: boolean }) {
  const source = await prisma.role.findUniqueOrThrow({
    where: { id: await roleId("ADMIN") },
    include: { permissions: true, dataScopes: true },
  });
  const copy = await prisma.role.create({
    data: {
      name: `Admin ${randomUUID().slice(0, 8)}`,
      permissions: { create: source.permissions.map((p) => ({ permission: p.permission })) },
      dataScopes: {
        create: source.dataScopes.map((s) => ({
          resource: s.resource,
          scope: options.ownSchedule && s.resource === "schedule" ? "OWN" : s.scope,
        })),
      },
      fieldMasks: { create: (options.masks ?? []).map((field) => ({ field })) },
    },
  });
  return (await createTestUser("ADMIN", { allBranches: true, roleId: copy.id })).actor;
}

type Slot = { date: string; startTime?: string; endTime?: string };

/** Books a session and completes it: it credits the PT and uses a session. */
async function train(scenario: Scenario, approver: Awaited<ReturnType<typeof admin>>, slot: Slot, trainerId?: string) {
  const booking = await book(scenario.manager, scenario, slot, trainerId);
  await completeSession(approver, booking.id);
  return booking;
}

describe("the PT revenue allocation (D-032, A-166 to A-170)", () => {
  it("counts what credits the PT: trained, no-show and Burn Show, and not a deleted or a booked session", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    const { trainer, contract } = scenario;
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" });
    const mistaken = await train(scenario, root, { date: "07/10/2026", startTime: "09:00", endTime: "10:00" });
    const noShow = await book(scenario.manager, scenario, { date: "08/10/2026", startTime: "09:00", endTime: "10:00" });
    await markNoShow(scenario.manager, noShow.id);
    await burnShow(root, {
      contractId: contract.id,
      trainerId: trainer.id,
      date: "09/10/2026",
      startTime: "09:00",
      endTime: "10:00",
      reasonId: BURN_REASON,
    });
    // Booked, not yet trained: credits nobody.
    await book(scenario.manager, scenario, { date: "10/10/2026", startTime: "09:00", endTime: "10:00" });

    let report = await ptRevenueReport(root, OCTOBER);
    expect(report.trainers).toHaveLength(1);
    const [row] = report.trainers[0]!.rows;
    expect(row).toMatchObject({
      customer: { customerCode: scenario.customer.customerCode, phone: "0909123456" },
      contract: { contractCode: contract.contractCode, contractType: "NEW", contractValue: 12_000_000 },
      allocationValue: 12_000_000,
      sessions: 24,
      allocationPerSession: 500_000,
      credited: 5,
      commissionRate: 100,
      timesheetRate: 100,
      allocation: 2_500_000,
      adjustments: 0,
    });
    expect(report.trainers[0]).toMatchObject({
      employee: { id: trainer.id, fullName: "PT Minh" },
      credited: 5,
      allocation: 2_500_000,
      classSessions: 0,
    });
    expect(report.totals).toEqual({
      credited: 5,
      classSessions: 0,
      allocation: 2_500_000,
      payable: 2_500_000,
      adjustments: 0,
    });

    // Deleting a trained session from the history takes its credit away by itself (D-026, T-050).
    await deleteTrainedSession(root, mistaken.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });
    report = await ptRevenueReport(root, OCTOBER);
    expect(report.trainers[0]!.rows[0]).toMatchObject({ credited: 4, allocation: 2_000_000 });
    expect(report.totals.allocation).toBe(2_000_000);
  });

  it("splits a contract between the PTs by the sessions each taught, and rows add up to the contract's share", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    const second = await createTrainer(scenario.manager, { fullName: "PT Hoa" });
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" }, second.id);
    await train(scenario, root, { date: "07/10/2026", startTime: "09:00", endTime: "10:00" }, second.id);

    const report = await ptRevenueReport(root, OCTOBER);

    expect(report.trainers.map((trainer) => [trainer.employee.fullName, trainer.credited, trainer.allocation])).toEqual(
      expect.arrayContaining([
        ["PT Minh", 1, 500_000],
        ["PT Hoa", 2, 1_000_000],
      ]),
    );
    expect(report.trainers.every((trainer) => trainer.rows[0]!.contract.id === scenario.contract.id)).toBe(true);
    expect(report.totals).toMatchObject({ credited: 3, allocation: 1_500_000 });

    const onlyHoa = await ptRevenueReport(root, { ...OCTOBER, trainerId: second.id });
    expect(onlyHoa.trainers.map((trainer) => trainer.employee.fullName)).toEqual(["PT Hoa"]);
  });

  it("applies the service's commission rate and the timesheet rate (OQ-022 interim)", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" });
    const service = await prisma.service.findFirstOrThrow({
      where: { contracts: { some: { id: scenario.contract.id } } },
    });
    await updateService(root, service.id, {
      name: service.name,
      kind: service.kind,
      branchIds: [DEFAULT_BRANCH_ID],
      commissionRate: 50,
    });
    await updateParameters(root, { ...PARAMETER_DEFAULTS, ptTimesheetRate: "80" });

    const report = await ptRevenueReport(root, OCTOBER);

    // 2 sessions × 500,000 × 50% × 80%
    expect(report.trainers[0]!.rows[0]).toMatchObject({ commissionRate: 50, timesheetRate: 80, allocation: 400_000 });
  });

  it("counts the sessions inside and outside the PT's shift, and a day off is outside (D-058)", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    const { trainer } = scenario;
    await replaceShifts(scenario.manager, trainer.id, {
      shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "08:00", end: "12:00" })),
    });
    await addDayOff(scenario.manager, trainer.id, { date: "05/10/2026" });
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" }); // day off
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" }); // inside
    await train(scenario, root, { date: "06/10/2026", startTime: "12:00", endTime: "13:00" }); // the shift's end
    await train(scenario, root, { date: "06/10/2026", startTime: "18:00", endTime: "19:00" }); // outside
    await train(scenario, root, { date: "07/10/2026", startTime: "08:00", endTime: "09:00" }); // the shift's start

    const [pt] = (await ptRevenueReport(root, OCTOBER)).trainers;

    expect(pt).toMatchObject({ credited: 5, inShift: 2, outsideShift: 3 });
    expect(pt!.rows[0]).toMatchObject({ inShift: 2, outsideShift: 3 });
  });

  it("puts a session in the gym's day it was scheduled for, not the UTC day", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    // 00:00 on 10/10 in the gym is still 09/10 in UTC; 23:00 on 09/10 is 16:00 UTC the same day.
    await train(scenario, root, { date: "09/10/2026", startTime: "23:00", endTime: "23:59" });
    await train(scenario, root, { date: "10/10/2026", startTime: "00:00", endTime: "01:00" });

    const credited = async (from: string, to: string) => (await ptRevenueReport(root, { from, to })).totals.credited;

    expect(await credited("09/10/2026", "09/10/2026")).toBe(1);
    expect(await credited("10/10/2026", "10/10/2026")).toBe(1);
    expect(await credited("09/10/2026", "10/10/2026")).toBe(2);
    expect(await credited("01/10/2026", "08/10/2026")).toBe(0);
  });

  it("refuses an upside-down or too long period", async () => {
    const root = await admin();
    await expect(ptRevenueReport(root, { from: "10/10/2026", to: "01/10/2026" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(ptRevenueReport(root, { from: "01/01/2010", to: "01/10/2026" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(ptRevenueReport(root, { trainerId: "nope" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("lists a coach who taught a class with someone present, with no revenue (A-164)", async () => {
    const root = await admin();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { coach } = await everyDayClass(root, manager);
    const { customer, contract } = await classCustomer(manager);
    const { listClassSessions } = await import("../../src/modules/classes/class.service.js");
    const today = (await listClassSessions(root, { date: gymTodayText(), days: 1 }))[0]!;
    const enrolled = await enrollCustomer(reception, today.id, { customerId: customer.id, contractId: contract.id });
    await markAttendance(root, today.id, enrolled.attendees![0]!.id, { status: "PRESENT" });

    const report = await ptRevenueReport(root, { from: gymTodayText(), to: gymTodayText() });

    expect(report.trainers).toHaveLength(1);
    expect(report.trainers[0]).toMatchObject({
      employee: { id: coach.id },
      rows: [],
      classSessions: 1,
      credited: 0,
      allocation: 0,
    });
    expect(report.totals.classSessions).toBe(1);
  });

  it("is for the roles that have it, with whole data scope, receipts visible, and the actor's branches", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });

    for (const role of ["PT", "RECEPTIONIST", "CONSULTING", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(ptRevenueReport(actor, OCTOBER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const role of ["ACCOUNTANT", "FITNESS_MANAGER"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      expect((await ptRevenueReport(actor, OCTOBER)).totals.credited).toBe(1);
    }
    await expect(ptRevenueReport(await restrictedAdmin({ ownSchedule: true }), OCTOBER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(ptRevenueReport(await restrictedAdmin({ masks: ["receipts.totals"] }), OCTOBER)).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );

    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect((await ptRevenueReport(elsewhere, OCTOBER)).trainers).toEqual([]);
    await expect(ptRevenueReport(elsewhere, { ...OCTOBER, branchId: DEFAULT_BRANCH_ID })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("hides the phone from a role that has it masked, here and in the Excel file (D-017)", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    const masked = await restrictedAdmin({ masks: ["customer.phone"] });

    const report = await ptRevenueReport(masked, OCTOBER);

    expect(report.trainers[0]!.rows[0]!.customer.phone).toBeNull();
    expect(ptRevenueExport.columns.find((column) => column.maskedBy === "customer.phone")).toBeDefined();
  });

  it("exports GymMaster's columns with a total after each PT and a grand total last", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" });

    const { items, total } = await ptRevenueExport.fetch(root, OCTOBER, 1, 100);

    expect(total).toBe(3);
    expect(items.map((line) => line.kind)).toEqual(["row", "trainer", "total"]);
    const headers = ptRevenueExport.columns.map((column) => column.header.vi);
    expect(headers.slice(0, 4)).toEqual(["Mã nhân viên", "Tên nhân viên", "Mã hội viên", "Tên hội viên"]);
    const allocation = ptRevenueExport.columns.find((column) => column.header.vi === "Doanh thu PT")!;
    expect(items.map((line) => allocation.value(line, "vi"))).toEqual([1_000_000, 1_000_000, 1_000_000]);
    // GymMaster's "Tổng show": the PT's sessions of the period on each of their rows.
    const shows = ptRevenueExport.columns.find((column) => column.header.vi === "Tổng show")!;
    expect(items.map((line) => shows.value(line, "vi"))).toEqual([2, null, null]);
  });
});

describe("the booking report (brief §9, A-171)", () => {
  async function bookings() {
    const scenario = await bookingScenario();
    const root = await admin();
    const trained = await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    const booked = await book(scenario.manager, scenario, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" });
    await burnShow(root, {
      contractId: scenario.contract.id,
      trainerId: scenario.trainer.id,
      date: "07/10/2026",
      startTime: "09:00",
      endTime: "10:00",
      reasonId: BURN_REASON,
    });
    const deleted = await train(scenario, root, { date: "08/10/2026", startTime: "09:00", endTime: "10:00" });
    await deleteTrainedSession(root, deleted.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm" });
    return { scenario, root, trained, booked };
  }

  it("lists the sessions of the period, newest first, with check-in and check-out, and leaves out deleted ones", async () => {
    const { root, trained, booked } = await bookings();

    const page = await bookingReport(root, OCTOBER);

    expect(page.total).toBe(3);
    expect(page.items.map((row) => row.type)).toEqual(["BURN_SHOW", "PT", "PT"]);
    const trainedRow = page.items.find((row) => row.id === trained.id)!;
    expect(trainedRow).toMatchObject({
      customer: { fullName: "Nguyễn Văn An", phone: "0909123456" },
      staff: { fullName: "PT Minh" },
      status: { code: "TRAINED" },
    });
    expect(trainedRow.checkedInAt).toBeInstanceOf(Date);
    expect(trainedRow.checkedOutAt).toBeInstanceOf(Date);
    const bookedRow = page.items.find((row) => row.id === booked.id)!;
    expect(bookedRow).toMatchObject({ status: { code: "BOOKED" }, checkedInAt: null, checkedOutAt: null });
  });

  it("filters by type, status, PT and period, and pages", async () => {
    const { scenario, root } = await bookings();

    expect((await bookingReport(root, { ...OCTOBER, type: "BURN_SHOW" })).items).toHaveLength(1);
    expect((await bookingReport(root, { ...OCTOBER, type: "PT" })).total).toBe(2);
    expect((await bookingReport(root, { ...OCTOBER, status: "BOOKED" })).total).toBe(1);
    expect((await bookingReport(root, { ...OCTOBER, trainerId: scenario.trainer.id })).total).toBe(3);
    expect((await bookingReport(root, { ...OCTOBER, trainerId: randomUUID() })).total).toBe(0);
    expect((await bookingReport(root, { from: "06/10/2026", to: "06/10/2026" })).total).toBe(1);
    const first = await bookingReport(root, { ...OCTOBER, pageSize: "2" });
    const second = await bookingReport(root, { ...OCTOBER, pageSize: "2", page: "2" });
    expect([first.items.length, second.items.length, first.total]).toEqual([2, 1, 3]);
    await expect(bookingReport(root, { ...OCTOBER, type: "CLASS" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("is for admin, the manager and reception; phones follow the mask; branches follow the actor", async () => {
    const { root } = await bookings();
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      expect((await bookingReport(actor, OCTOBER)).total).toBe(3);
    }
    for (const role of ["ACCOUNTANT", "CONSULTING", "PT"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(bookingReport(actor, OCTOBER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(bookingReport(await restrictedAdmin({ ownSchedule: true }), OCTOBER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const masked = await restrictedAdmin({ masks: ["customer.phone"] });
    expect((await bookingReport(masked, OCTOBER)).items.every((row) => row.customer.phone === null)).toBe(true);
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect((await bookingReport(elsewhere, OCTOBER)).total).toBe(0);
    expect(root).toBeDefined();
  });

  it("exports the rows of the screen a page at a time", async () => {
    const { root } = await bookings();

    const { items, total } = await bookingReportExport.fetch(root, OCTOBER, 1, 2);

    expect([items.length, total]).toEqual([2, 3]);
    expect(bookingReportExport.columns.find((column) => column.maskedBy === "customer.phone")).toBeDefined();
  });
});

describe("the overview dashboard (docs/10, A-172)", () => {
  const PERIOD = () => ({ from: "01/10/2026", to: gymTodayText() });

  async function show(reception: Awaited<ReturnType<typeof createTestUser>>["actor"], fullName: string) {
    const lead = await createLead(reception, { fullName, channelId: WHATSAPP, phone: uniquePhone() });
    await showLead(reception, lead.id, {
      idDocumentType: "CCCD",
      idDocumentNumber: "079201001234",
      birthDate: "15/03/1990",
      countryCode: "VN",
      email: "an@example.com",
      phone: uniquePhone(),
      healthNote: "Khỏe",
      consent: true,
    });
    return lead.id;
  }

  it("counts new leads and how many have a contract, members training, PTs, contracts ending soon, hours and revenue", async () => {
    const scenario = await bookingScenario();
    const root = await admin();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await train(scenario, root, { date: "05/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "06/10/2026", startTime: "09:00", endTime: "10:00" });
    await train(scenario, root, { date: "07/10/2026", startTime: "18:00", endTime: "19:00" });
    await recordPayment(
      root,
      scenario.contract.id,
      { amount: 3_000_000, methodId: CASH, paidOn: "05/10/2026" },
      randomUUID(),
    );
    // A contract with 3 sessions: running out.
    const small = await createCustomer(scenario.manager, { fullName: "Khách ít buổi", phone: uniquePhone() });
    await activeContract(scenario.manager, small.id, { sessions: 3 });
    // Two leads: one showed and signed, one did not.
    const converted = await show(reception, "Lead đã ký");
    await createLead(reception, { fullName: "Lead chưa ký", channelId: WHATSAPP, phone: uniquePhone() });
    await activeContract(scenario.manager, converted, { sessions: 24 });

    const board = await overview(root, PERIOD());

    expect(board).toMatchObject({
      newLeads: 2,
      convertedLeads: 1,
      conversionRate: 50,
      membersTraining: 1,
      activePts: 1,
    });
    expect(board.endingSoon).toBe(1);
    expect(board.sessionsByHour).toHaveLength(24);
    expect(board.sessionsByHour[9]).toEqual({ hour: 9, sessions: 2 });
    expect(board.sessionsByHour[18]).toEqual({ hour: 18, sessions: 1 });
    expect(board.revenueByMonth).toHaveLength(12);
    expect(board.revenueByMonth?.find((month) => month.month === "2026-10")).toEqual({
      month: "2026-10",
      revenue: 3_000_000,
    });
    expect(board.revenueByMonth?.at(-1)?.month).toBe(PERIOD().to.split("/").reverse().slice(0, 2).join("-"));
  });

  it("counts class attendance as training, and is empty on a new system", async () => {
    const root = await admin();
    expect(await overview(root, PERIOD())).toMatchObject({
      newLeads: 0,
      convertedLeads: 0,
      conversionRate: 0,
      membersTraining: 0,
      activePts: 0,
      endingSoon: 0,
    });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await everyDayClass(root, manager);
    const { customer, contract } = await classCustomer(manager);
    const { listClassSessions } = await import("../../src/modules/classes/class.service.js");
    const today = (await listClassSessions(root, { date: gymTodayText(), days: 1 }))[0]!;
    const enrolled = await enrollCustomer(reception, today.id, { customerId: customer.id, contractId: contract.id });
    await markAttendance(root, today.id, enrolled.attendees![0]!.id, { status: "PRESENT" });

    expect((await overview(root, PERIOD())).membersTraining).toBe(1);
  });

  it("is for admin, the manager, the accountant and reception; revenue follows the mask; branches follow the actor", async () => {
    for (const role of ["FITNESS_MANAGER", "ACCOUNTANT", "RECEPTIONIST"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      expect((await overview(actor, PERIOD())).revenueByMonth).toHaveLength(12);
    }
    for (const role of ["PT", "CONSULTING", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(overview(actor, PERIOD())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await overview(await restrictedAdmin({ masks: ["receipts.totals"] }), PERIOD())).revenueByMonth).toBeNull();
    await expect(overview(await restrictedAdmin({ ownSchedule: true }), PERIOD())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("ADMIN", { branchIds: [other.id] });
    expect(await overview(elsewhere, PERIOD())).toMatchObject({ newLeads: 0, activePts: 0 });
  });
});
