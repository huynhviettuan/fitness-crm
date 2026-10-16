import { afterEach, describe, expect, it } from "vitest";
import { taskReport } from "../../src/modules/reports/task-report.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, createTestUser, optionId } from "../support/factories.js";

afterEach(resetDatabase);

// The tasks report (M9.1; brief §9; FR-TASK-006, A-045): tasks given, done on time, done late and overdue, by person and by
// department, for the tasks whose deadline falls in the period.

const at = (iso: string) => new Date(`${iso}T05:00:00Z`);

async function world() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: assigner } = await createTestUser("FITNESS_MANAGER");
  const { actor: ann } = await createTestUser("RECEPTIONIST", { name: "Ann" });
  const { actor: bao } = await createTestUser("RECEPTIONIST", { name: "Bao" });
  const studio = await optionId("departments", "Studio");
  return { admin, assigner, ann, bao, studio };
}
type World = Awaited<ReturnType<typeof world>>;

type Seed = {
  to?: "ann" | "bao" | "studio";
  status: "NEW" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  due: string;
  done?: string;
};

async function task(w: World, seed: Seed) {
  const person = seed.to === "ann" ? w.ann : seed.to === "bao" ? w.bao : null;
  return prisma.task.create({
    data: {
      branchId: DEFAULT_BRANCH_ID,
      title: "Việc thử",
      assignerId: w.assigner.id,
      assigneeUserId: person?.id ?? null,
      assigneeDepartmentId: seed.to === "studio" ? w.studio : null,
      dueAt: at(seed.due),
      status: seed.status,
      doneAt: seed.done ? at(seed.done) : null,
    },
  });
}

const period = { from: "01/06/2020", to: "30/06/2020" };

describe("the tasks report", () => {
  it("counts the tasks of each person: on time, late, overdue and cancelled, and the on-time rate", async () => {
    const w = await world();
    await task(w, { to: "ann", status: "DONE", due: "2020-06-10", done: "2020-06-09" });
    await task(w, { to: "ann", status: "DONE", due: "2020-06-10", done: "2020-06-10" });
    await task(w, { to: "ann", status: "DONE", due: "2020-06-10", done: "2020-06-12" });
    await task(w, { to: "ann", status: "IN_PROGRESS", due: "2020-06-15" });
    await task(w, { to: "ann", status: "CANCELLED", due: "2020-06-15" });
    await task(w, { to: "bao", status: "NEW", due: "2020-06-20" });

    const report = await taskReport(w.admin, period);
    const ann = report.byPerson.find((row) => row.user?.name === "Ann")!;
    expect(ann).toMatchObject({ assigned: 5, doneOnTime: 2, doneLate: 1, overdue: 1, open: 0, cancelled: 1 });
    // 2 on time of 4 decided (3 done and 1 overdue); the cancelled one is not judged.
    expect(ann.onTimeRate).toBe(50);
    expect(report.byPerson.find((row) => row.user?.name === "Bao")).toMatchObject({ assigned: 1, overdue: 1 });
    // The most overdue is first.
    expect(report.byPerson.map((row) => row.user?.name)).toEqual(["Ann", "Bao"]);
    expect(report.totals).toMatchObject({ assigned: 6, doneOnTime: 2, doneLate: 1, overdue: 2, cancelled: 1 });
    expect(report.totals.onTimeRate).toBe(40);
  });

  it("counts a task in the period of its deadline, and a task not yet due is open, not overdue", async () => {
    const w = await world();
    await task(w, { to: "ann", status: "NEW", due: "2020-05-31" });
    await task(w, { to: "ann", status: "NEW", due: "2020-07-01" });
    await task(w, { to: "ann", status: "NEW", due: "2020-06-30" });
    await task(w, { to: "ann", status: "NEW", due: "2031-01-15" });
    expect((await taskReport(w.admin, period)).totals.assigned).toBe(1);
    const future = await taskReport(w.admin, { from: "01/01/2031", to: "31/01/2031" });
    expect(future.totals).toMatchObject({ assigned: 1, open: 1, overdue: 0, onTimeRate: 0 });
  });

  it("groups by department: the one a task was given to, and the one of the person it was given to", async () => {
    const w = await world();
    await prisma.employee.create({
      data: {
        branchId: DEFAULT_BRANCH_ID,
        employeeCode: "NV-T1",
        fullName: "Ann",
        searchName: "ann",
        userId: w.ann.id,
        departmentId: w.studio,
      },
    });
    // A task given to a department waits for someone to accept it, so it cannot be done yet.
    await task(w, { to: "studio", status: "NEW", due: "2020-06-10" });
    await task(w, { to: "ann", status: "NEW", due: "2020-06-11" });
    await task(w, { to: "bao", status: "NEW", due: "2020-06-11" });

    const report = await taskReport(w.admin, period);
    // Studio: the one given to it, and Ann's (Ann works in Studio); Bao has no department, so is in no department row.
    expect(report.byDepartment).toHaveLength(1);
    expect(report.byDepartment[0]).toMatchObject({
      department: { labelVi: "Studio" },
      assigned: 2,
      doneOnTime: 0,
      overdue: 2,
    });
    expect(report.byPerson.find((row) => row.user?.name === "Ann")!.department?.labelVi).toBe("Studio");
    // The totals count every task, including those given to a department only and to a person without one.
    expect(report.totals.assigned).toBe(3);
  });

  it("can be limited to one person, and by default is for the whole period of this month", async () => {
    const w = await world();
    await task(w, { to: "ann", status: "NEW", due: "2020-06-11" });
    await task(w, { to: "bao", status: "NEW", due: "2020-06-11" });
    const one = await taskReport(w.admin, { ...period, userId: w.bao.id });
    expect(one.byPerson.map((row) => row.user?.name)).toEqual(["Bao"]);
    expect(one.totals.assigned).toBe(1);
    expect((await taskReport(w.admin, {})).from).toBeInstanceOf(Date);
  });

  it("is for those who hold the permission, over the whole scope, and refuses a bad period or person", async () => {
    const w = await world();
    await expect(taskReport(w.ann, period)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(taskReport(w.admin, { from: "30/06/2020", to: "01/06/2020" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(taskReport(w.admin, { ...period, userId: "nope" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(taskReport(w.admin, { ...period, branchId: "nope" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
