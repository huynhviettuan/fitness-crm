import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createArea, createExercise } from "../../src/modules/workouts/catalog.service.js";
import { listEscalations, markSeen } from "../../src/modules/workouts/escalation.service.js";
import { createLog, getLog, updateLog } from "../../src/modules/workouts/log.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";
import { book, bookingScenario, linkedTrainer } from "../support/bookings.js";

afterEach(resetDatabase);

// Escalation (M7.4; brief §7.4; FR-WKO-004; AC-21; A-206 to A-211).

async function world() {
  const scenario = await bookingScenario();
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: master } = await createTestUser("MASTER", { allBranches: true });
  const pt = await linkedTrainer(scenario.manager, "PT Linh");
  const area = await createArea(admin, { code: "LOW", name: "Thân dưới" });
  const squat = await createExercise(admin, { name: "Squat", areaId: area.id, kind: "STRENGTH" });
  const press = await createExercise(admin, { name: "Đẩy tạ", areaId: area.id, kind: "STRENGTH" });
  const flag = await optionId("workoutFlags", "Stress");
  const normal = await optionId("workoutFlags", "Normal");
  const none = await optionId("workoutActions", "None");
  const stop = await optionId("workoutActions", "Dừng + Escalation");
  const log = await createLog(pt.actor, {
    bookingId: (await book(scenario.manager, scenario, { date: "15/10/2026" }, pt.trainer.id)).id,
  });
  return { ...scenario, admin, master, pt, squat, press, flag, normal, none, stop, log };
}
type World = Awaited<ReturnType<typeof world>>;

/** The log saved with a Squat of the given sets: each `[actionId, flagId, note]`. */
async function save(w: World, sets: [string, string, string][], extra: Record<string, unknown> = {}) {
  const current = await getLog(w.pt.actor, w.log.id);
  const kept = current.items.map((item) => ({
    id: item.id,
    exerciseId: item.exercise.id,
    sets: item.sets.map((set) => ({
      id: set.id,
      flagId: set.flag.id,
      actionId: set.action.id,
      note: set.note,
    })),
  }));
  return updateLog(w.pt.actor, w.log.id, {
    ...extra,
    items: [
      ...kept,
      ...(sets.length > 0
        ? [
            {
              exerciseId: w.squat.id,
              sets: sets.map(([actionId, flagId, note]) => ({ weight: "40", reps: "5", actionId, flagId, note })),
            },
          ]
        : []),
    ],
  });
}

describe("raising an escalation (brief §7.4)", () => {
  it("tells the manager and the Master at once, makes a task, and does it once for a set", async () => {
    const w = await world();
    const saved = await save(w, [
      [w.none, w.normal, ""],
      [w.stop, w.flag, "Đau lưng, dừng tập"],
    ]);
    const stopped = saved.items[0]!.sets[1]!;
    expect(stopped.escalation).toMatchObject({ seenAt: null, seenBy: null, direction: null });

    const rows = await prisma.workoutEscalation.findMany({ include: { task: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      logId: w.log.id,
      setId: stopped.id,
      exerciseName: "Squat",
      setNo: 2,
      flagId: w.flag,
      note: "Đau lưng, dừng tập",
      raisedById: w.pt.actor.id,
      seenAt: null,
    });
    // The task waits in Giao việc, about the log, with the customer, exercise and Flag in it.
    expect(rows[0]!.task).toMatchObject({
      status: "NEW",
      priority: "HIGH",
      entityType: "workoutLog",
      entityId: w.log.id,
      source: "workoutEscalation",
      assignerId: w.pt.actor.id,
    });
    expect(rows[0]!.task!.title).toContain("Nguyễn Văn An");
    expect(rows[0]!.task!.description).toContain("Stress");

    // The people who review workouts are told, with a link to the session; the coach is not.
    const told = await prisma.notification.findMany({ where: { kind: "workoutEscalation" } });
    const ids = told.map((item) => item.userId);
    const reviewers = (
      await prisma.user.findMany({ where: { role: { permissions: { some: { permission: "workout.review" } } } } })
    ).map((user) => user.id);
    expect(ids.sort()).toEqual(reviewers.sort());
    expect(ids).toEqual(expect.arrayContaining([w.manager.id, w.admin.id, w.master.id]));
    expect(ids).not.toContain(w.pt.actor.id);
    expect(told[0]).toMatchObject({ link: `/workouts/logs/${w.log.id}` });
    expect(told[0]!.params).toMatchObject({
      customer: "Nguyễn Văn An",
      trainer: "PT Linh",
      exercise: "Squat",
      flag: "Stress",
      note: "Đau lưng, dừng tập",
    });
    // The task is assigned to the first of them (no manager department is set).
    expect(ids).toContain(rows[0]!.task!.assigneeUserId);

    // Saving again, with the same Action, raises nothing more and tells nobody again.
    await save(w, []);
    expect(await prisma.workoutEscalation.count()).toBe(1);
    expect(await prisma.notification.count({ where: { kind: "workoutEscalation" } })).toBe(ids.length);
    expect(await prisma.task.count({ where: { source: "workoutEscalation" } })).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { entityId: rows[0]!.id, action: "workout_escalation.raised" } }),
    ).toBe(1);
  });

  it("is raised by a set added later, one for each, and not by the other Actions", async () => {
    const w = await world();
    await save(w, [[w.none, w.normal, "x"]]);
    expect(await prisma.workoutEscalation.count()).toBe(0);
    await save(w, [[w.stop, w.flag, ""]]);
    await save(w, [
      [w.stop, w.normal, "Chóng mặt"],
      [w.stop, w.flag, ""],
    ]);
    expect(await prisma.workoutEscalation.count()).toBe(3);
    expect(await prisma.task.count({ where: { source: "workoutEscalation" } })).toBe(3);
  });

  it("stays raised when the coach takes the set out of the log", async () => {
    const w = await world();
    await save(w, [[w.stop, w.flag, "Dừng"]]);
    const escalation = await prisma.workoutEscalation.findFirstOrThrow();
    // The coach's own exercise goes out of the log; the escalation keeps what it said.
    await updateLog(w.pt.actor, w.log.id, { items: [] });
    const after = await prisma.workoutEscalation.findUniqueOrThrow({ where: { id: escalation.id } });
    expect(after).toMatchObject({ setId: null, exerciseName: "Squat", setNo: 1, note: "Dừng" });
  });
});

describe("marking an escalation seen (brief §7.4)", () => {
  it("closes it with a direction: it leaves the waiting list, its task is done, and the coach is told", async () => {
    const w = await world();
    await save(w, [[w.stop, w.flag, "Đau lưng"]]);
    expect((await listEscalations(w.manager, { status: "WAITING" })).items).toHaveLength(1);
    const waiting = (await listEscalations(w.manager, {})).items[0]!;
    expect(waiting).toMatchObject({
      status: "WAITING",
      canMarkSeen: true,
      exercise: { name: "Squat" },
      setNo: 1,
      note: "Đau lưng",
      customer: { id: w.customer.id },
      trainer: { id: w.pt.trainer.id },
    });

    const seen = await markSeen(w.master, waiting.id, { direction: "Nghỉ buổi này, khám lại lưng" });
    expect(seen).toMatchObject({
      status: "SEEN",
      canMarkSeen: false,
      direction: "Nghỉ buổi này, khám lại lưng",
      seenBy: { id: w.master.id },
    });
    expect((await listEscalations(w.manager, { status: "WAITING" })).items).toHaveLength(0);
    expect((await listEscalations(w.manager, { status: "SEEN" })).items).toHaveLength(1);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: waiting.taskId! }, include: { comments: true } });
    expect(task.status).toBe("DONE");
    expect(task.comments.map((comment) => comment.body)).toEqual(["Nghỉ buổi này, khám lại lưng"]);
    const told = await prisma.notification.findMany({ where: { kind: "workoutEscalationSeen" } });
    expect(told.map((item) => item.userId)).toEqual([w.pt.actor.id]);
    // The log shows it beside the set.
    const log = await getLog(w.pt.actor, w.log.id);
    expect(log.items[0]!.sets[0]!.escalation).toMatchObject({ direction: "Nghỉ buổi này, khám lại lưng" });

    // Marking it again changes nothing: the first direction stays, nobody is told twice.
    const again = await markSeen(w.manager, waiting.id, { direction: "Khác" });
    expect(again).toMatchObject({ direction: "Nghỉ buổi này, khám lại lưng", seenBy: { id: w.master.id } });
    expect(await prisma.notification.count({ where: { kind: "workoutEscalationSeen" } })).toBe(1);
  });

  it("two people marking it at once leave it with the first", async () => {
    const w = await world();
    await save(w, [[w.stop, w.flag, ""]]);
    const id = (await listEscalations(w.manager, {})).items[0]!.id;
    const results = await Promise.all([
      markSeen(w.manager, id, { direction: "A" }),
      markSeen(w.master, id, { direction: "B" }),
    ]);
    expect(results[0]!.direction).toBe(results[1]!.direction);
    expect(await prisma.notification.count({ where: { kind: "workoutEscalationSeen" } })).toBe(1);
  });

  it("needs a direction and the right to review; a PT sees their own and cannot mark", async () => {
    const w = await world();
    await save(w, [[w.stop, w.flag, ""]]);
    const id = (await listEscalations(w.manager, {})).items[0]!.id;
    for (const bad of [
      {},
      { direction: "" },
      { direction: "   " },
      { direction: "a\u0007b" },
      { direction: "x".repeat(1001) },
    ]) {
      await expect(markSeen(w.manager, id, bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    // The PT reads their own escalation but cannot mark it seen.
    expect((await listEscalations(w.pt.actor, {})).items).toMatchObject([{ id, canMarkSeen: false }]);
    await expect(markSeen(w.pt.actor, id, { direction: "ok" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stranger = await linkedTrainer(w.manager, "PT Hoa");
    expect((await listEscalations(stranger.actor, {})).items).toEqual([]);
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(listEscalations(actor, {}), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(markSeen(actor, id, { direction: "ok" }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(markSeen(w.manager, randomUUID(), { direction: "ok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markSeen(w.manager, "nope", { direction: "ok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listEscalations(w.manager, { status: "NOPE" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // Still waiting after all that.
    expect((await listEscalations(w.manager, { status: "WAITING" })).items).toHaveLength(1);
  });
});
