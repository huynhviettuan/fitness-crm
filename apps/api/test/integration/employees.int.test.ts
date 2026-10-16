import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  addDayOff,
  createEmployee,
  getEmployee,
  getWorkSchedule,
  listEmployeeLogins,
  listEmployees,
  removeDayOff,
  replaceShifts,
  trainersOfDay,
  updateEmployee,
} from "../../src/modules/employees/employee.service.js";
import { resetDatabase } from "../support/database.js";
import { actorOf, createTestBranch, createTestOption, createTestUser, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

describe("createEmployee (brief §8.4)", () => {
  it("creates an active employee with a generated NV code, the profile, and an audit event", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const department = await createTestOption("departments", "Kinh doanh");

    const employee = await createEmployee(manager, {
      fullName: "  Trần Minh  ",
      birthDate: "02/03/1995",
      gender: "MALE",
      phone: "0901 234 567",
      email: "Minh@DemoGym.vn",
      departmentId: department,
      team: "Ca sáng",
      isTrainer: true,
    });

    expect(employee).toMatchObject({
      employeeCode: expect.stringMatching(/^NV\d{3,}$/),
      fullName: "Trần Minh",
      birthDate: new Date(Date.UTC(1995, 2, 2)),
      gender: "MALE",
      phone: "0901234567",
      email: "minh@demogym.vn",
      department: { id: department, labelVi: "Kinh doanh", note: null },
      team: "Ca sáng",
      title: null,
      status: "ACTIVE",
      isTrainer: true,
      user: null,
    });
    const audit = await prisma.auditEvent.findMany({ where: { entityId: employee.id } });
    expect(audit).toEqual([
      expect.objectContaining({
        action: "employee.created",
        actorUserId: manager.id,
        after: expect.objectContaining({ employeeCode: employee.employeeCode, isTrainer: true }),
      }),
    ]);
  });

  it("gives employees created at the same time different codes (T-019)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const employees = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createEmployee(admin, { fullName: `NV ${i}` })),
    );

    expect(new Set(employees.map((e) => e.employeeCode)).size).toBe(5);
  });

  it.each(["RECEPTIONIST", "PT", "ACCOUNTANT", "MASTER"] as const)("refuses a %s (09_RBAC.md)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createEmployee(actor, { fullName: "NV" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns field errors for invalid input", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(createEmployee(manager, { fullName: " ", status: "RETIRED", phone: "12" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { fullName: ["required"], status: ["invalidChoice"], phone: ["invalidPhone"] },
    });
  });

  it("takes department and title from their own lists, Khác only with a note (D-016)", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const otherDepartment = await optionId("departments", "Khác");
    const paymentMethod = await optionId("paymentMethods", "Tiền mặt");
    const retired = await createTestOption("jobTitles", "Huấn luyện viên cũ", false);

    await expect(createEmployee(manager, { fullName: "A", departmentId: otherDepartment })).rejects.toMatchObject({
      fieldErrors: { departmentNote: ["otherNeedsNote"] },
    });
    await expect(createEmployee(manager, { fullName: "A", titleId: paymentMethod })).rejects.toMatchObject({
      fieldErrors: { titleId: ["invalidChoice"] },
    });
    await expect(createEmployee(manager, { fullName: "A", titleId: retired })).rejects.toMatchObject({
      fieldErrors: { titleId: ["invalidChoice"] },
    });
    await expect(
      createEmployee(manager, { fullName: "A", departmentId: otherDepartment, departmentNote: "Bảo vệ" }),
    ).resolves.toMatchObject({
      department: { isOther: true, note: "Bảo vệ" },
    });
  });
});

describe("linking a login (brief §8.4)", () => {
  it("links any login, and the user then acts as that employee", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("RECEPTIONIST");

    const employee = await createEmployee(manager, { fullName: "Võ Thị Hồng", userId: user.id });

    expect(employee.user).toMatchObject({ id: user.id, email: user.email });
    expect((await actorOf(user.id)).employeeId).toBe(employee.id);
    expect(await listEmployeeLogins(manager)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id, linkedEmployeeId: employee.id })]),
    );
  });

  it("refuses an unknown login", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(
      createEmployee(manager, { fullName: "A", userId: "0b9d2c4e-3f1a-4b5c-8d6e-7f8091a2b3c4" }),
    ).rejects.toMatchObject({
      fieldErrors: { userId: ["invalidChoice"] },
    });
  });

  it("refuses a login that already belongs to an employee, even when both links arrive at once", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");

    const results = await Promise.allSettled([
      createEmployee(manager, { fullName: "PT A", userId: user.id }),
      createEmployee(manager, { fullName: "PT B", userId: user.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "VALIDATION_FAILED", fieldErrors: { userId: ["userAlreadyLinked"] } },
    });
  });
});

describe("updateEmployee", () => {
  it("audits the changed fields and can unlink the login", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("PT");
    const employee = await createEmployee(admin, { fullName: "PT Linh", userId: user.id, isTrainer: true });

    const updated = await updateEmployee(admin, employee.id, {
      fullName: "PT Linh",
      status: "INACTIVE",
      isTrainer: true,
      userId: "",
    });

    expect(updated).toMatchObject({ status: "INACTIVE", user: null, employeeCode: employee.employeeCode });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: employee.id, action: "employee.updated" } });
    expect(audit).toMatchObject({
      before: { status: "ACTIVE", userId: user.id },
      after: { status: "INACTIVE", userId: null },
    });
  });

  it("keeps an inactive option the employee already has (D-016)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const title = await createTestOption("jobTitles", "PT bậc 1");
    const employee = await createEmployee(admin, { fullName: "PT Linh", titleId: title });
    await prisma.option.update({ where: { id: title }, data: { active: false } });

    await expect(
      updateEmployee(admin, employee.id, { fullName: "PT Linh Nguyễn", titleId: title }),
    ).resolves.toMatchObject({
      title: { id: title },
    });
  });

  it("is NOT_FOUND for an employee of a branch the manager does not work in (D-014)", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const branch = await createTestBranch();
    const elsewhere = await createEmployee(admin, { fullName: "NV Q7", branchId: branch.id });

    await expect(getEmployee(manager, elsewhere.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateEmployee(manager, elsewhere.id, { fullName: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listEmployees", () => {
  it("searches by name without diacritics, code, and phone, and filters trainers and status", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const minh = await createEmployee(admin, { fullName: "Trần Minh Đức", phone: "0909111222", isTrainer: true });
    const hong = await createEmployee(admin, { fullName: "Võ Thị Hồng" });
    await createEmployee(admin, { fullName: "Lê Nam", status: "INACTIVE", isTrainer: true });

    const ids = async (query: Record<string, string>) => (await listEmployees(admin, query)).items.map((e) => e.id);
    expect(await ids({ q: "minh duc" })).toEqual([minh.id]);
    expect(await ids({ q: hong.employeeCode.toLowerCase() })).toEqual([hong.id]);
    expect(await ids({ q: "0909 111" })).toEqual([minh.id]);
    expect(await ids({ trainersOnly: "true", status: "ACTIVE" })).toEqual([minh.id]);
    expect((await listEmployees(admin, { pageSize: "2" })).total).toBe(3);
  });

  it("shows a PT only themselves (staff scope only mine, 09_RBAC.md)", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");
    const own = await createEmployee(manager, { fullName: "PT Linh", userId: user.id, isTrainer: true });
    const other = await createEmployee(manager, { fullName: "PT Lan", isTrainer: true });
    const pt = await actorOf(user.id);

    expect((await listEmployees(pt, {})).items.map((e) => e.id)).toEqual([own.id]);
    await expect(getEmployee(pt, other.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is refused to a receptionist, who books through the calendar instead", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    await expect(listEmployees(reception, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("working schedule (D-030)", () => {
  const WEEKDAYS_8_TO_17 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" }));

  it("replaces the weekly shifts, audits the change, and lets the PT see but not change their own", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");
    const trainer = await createEmployee(manager, { fullName: "PT Linh", userId: user.id, isTrainer: true });
    const pt = await actorOf(user.id);

    const schedule = await replaceShifts(manager, trainer.id, {
      shifts: [...WEEKDAYS_8_TO_17, { weekday: 6, start: "07:00", end: "11:30" }],
    });

    expect(schedule.shifts).toHaveLength(6);
    expect(schedule.shifts.at(-1)).toEqual({ weekday: 6, start: "07:00", end: "11:30" });
    expect(await getWorkSchedule(pt, trainer.id)).toEqual(schedule);
    await expect(replaceShifts(pt, trainer.id, { shifts: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: trainer.id, action: "employee.shifts_changed" },
    });
    expect(audit).toMatchObject({
      before: { shifts: "" },
      after: { shifts: expect.stringContaining("6 07:00–11:30") },
    });
  });

  it("refuses overlapping shifts on one day", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const trainer = await createEmployee(manager, { fullName: "PT Linh", isTrainer: true });

    await expect(
      replaceShifts(manager, trainer.id, {
        shifts: [
          { weekday: 1, start: "08:00", end: "12:00" },
          { weekday: 1, start: "11:00", end: "13:00" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { shifts: ["shiftsOverlap"] } });
  });

  it("adds days off once each, lists those from today on, and removes them", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const trainer = await createEmployee(manager, { fullName: "PT Linh", isTrainer: true });

    await addDayOff(manager, trainer.id, { date: "01/01/2020", note: "Tết" });
    const future = await addDayOff(manager, trainer.id, { date: "02/01/2030", note: "Nghỉ phép" });
    await expect(addDayOff(manager, trainer.id, { date: "02/01/2030" })).rejects.toMatchObject({
      fieldErrors: { date: ["dayOffExists"] },
    });

    expect((await getWorkSchedule(manager, trainer.id)).daysOff).toEqual([future]);
    await removeDayOff(manager, trainer.id, future.id);
    expect((await getWorkSchedule(manager, trainer.id)).daysOff).toEqual([]);
    await expect(removeDayOff(manager, trainer.id, future.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const actions = await prisma.auditEvent.findMany({
      where: { entityId: trainer.id },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "employee.created",
      "employee.day_off_added",
      "employee.day_off_added",
      "employee.day_off_removed",
    ]);
  });

  it("gives the calendar each active trainer's working hours of the day, and none on a day off", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const linh = await createEmployee(manager, { fullName: "PT Linh", isTrainer: true });
    const lan = await createEmployee(manager, { fullName: "PT Lan", isTrainer: true });
    await createEmployee(manager, { fullName: "Lễ tân Hồng" });
    await createEmployee(manager, { fullName: "PT Nam", isTrainer: true, status: "INACTIVE" });
    await replaceShifts(manager, linh.id, {
      shifts: [
        { weekday: 4, start: "08:00", end: "12:00" },
        { weekday: 4, start: "12:00", end: "14:00" },
        { weekday: 4, start: "17:00", end: "24:00" },
      ],
    });
    await replaceShifts(manager, lan.id, { shifts: WEEKDAYS_8_TO_17 });
    await addDayOff(manager, lan.id, { date: "15/10/2026" });

    // 15/10/2026 is a Thursday.
    expect(await trainersOfDay(reception, { date: "15/10/2026" })).toEqual([
      {
        trainer: { id: lan.id, employeeCode: lan.employeeCode, fullName: "PT Lan" },
        branchId: lan.branch.id,
        dayOff: true,
        workingHours: [],
      },
      {
        trainer: { id: linh.id, employeeCode: linh.employeeCode, fullName: "PT Linh" },
        branchId: linh.branch.id,
        dayOff: false,
        workingHours: [
          { start: "08:00", end: "14:00" },
          { start: "17:00", end: "24:00" },
        ],
      },
    ]);
  });

  it("gives a PT only their own row, and nothing until their login belongs to an employee", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");
    await createEmployee(manager, { fullName: "PT Lan", isTrainer: true });

    expect(await trainersOfDay(await actorOf(user.id), { date: "15/10/2026" })).toEqual([]);
    const own = await createEmployee(manager, { fullName: "PT Linh", isTrainer: true, userId: user.id });
    expect((await trainersOfDay(await actorOf(user.id), { date: "15/10/2026" })).map((day) => day.trainer.id)).toEqual([
      own.id,
    ]);
  });
});
