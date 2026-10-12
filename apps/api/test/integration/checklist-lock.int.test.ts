import { afterEach, describe, expect, it } from "vitest";
import type { LeadChecklist } from "@flow/shared/leads";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import {
  completeLeadStep,
  leadChecklist,
  lockOverdueSteps,
  reopenLeadStep,
  todaySteps,
} from "../../src/modules/leads/checklist.service.js";
import { consultingReport } from "../../src/modules/reports/report.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const MINUTE = 60_000;
// The first step opens an hour after the lead is given; the grace period is two hours (D-054).
const GIVEN = new Date("2030-03-01T02:00:00Z");
const DUE = new Date(GIVEN.getTime() + 60 * MINUTE);

const step = (checklist: LeadChecklist, key: string) => {
  const found = checklist.items.find((item) => item.key === key);
  if (!found) throw new Error(`No step ${key}`);
  return found;
};

async function assignedLead() {
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: admin } = await createTestUser("ADMIN");
  const { actor: consultant } = await createTestUser("CONSULTING");
  const lead = await createLead(manager, { fullName: "Nguyễn Văn An", channelId: WHATSAPP }, GIVEN);
  return { manager, admin, consultant, lead };
}

describe('a step past its deadline and grace period locks as "Không thực hiện" (D-054)', () => {
  it("can still be ticked, as late, inside the grace period", async () => {
    const { consultant, lead } = await assignedLead();
    const first = step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van");

    const at = new Date(DUE.getTime() + 119 * MINUTE);
    expect(await lockOverdueSteps(at)).toBe(0);
    const checklist = await completeLeadStep(consultant, lead.id, first.id, { resultIndex: 0 }, at);

    expect(step(checklist, "tu-van")).toMatchObject({ state: "DONE", timing: "LATE", lockedAt: null });
  });

  it("locks once the grace period is over, writes it in the history, and is not ticked late any more", async () => {
    const { consultant, lead } = await assignedLead();
    const first = step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van");
    const at = new Date(DUE.getTime() + 121 * MINUTE);

    expect(await lockOverdueSteps(at)).toBeGreaterThanOrEqual(1);
    // Once: the next minute finds it locked already.
    expect(await lockOverdueSteps(new Date(at.getTime() + MINUTE))).toBe(0);

    const checklist = await leadChecklist(consultant, lead.id, at);
    expect(step(checklist, "tu-van")).toMatchObject({ state: "NOT_DONE", overdue: false, doneAt: null });
    expect(step(checklist, "tu-van").lockedAt).toBeInstanceOf(Date);
    await expect(completeLeadStep(consultant, lead.id, first.id, { resultIndex: 0 }, at)).rejects.toMatchObject({
      code: "STEP_LOCKED",
    });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.step_locked" } });
    expect(audit).toMatchObject({ actorUserId: null, after: { step: "tu-van" }, metadata: { graceMinutes: 120 } });
  });

  it("locks a step that is ticked too late even when the worker has not run yet, and keeps the lock", async () => {
    const { consultant, lead } = await assignedLead();
    const first = step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van");
    const at = new Date(DUE.getTime() + 300 * MINUTE);

    await expect(completeLeadStep(consultant, lead.id, first.id, { resultIndex: 0 }, at)).rejects.toMatchObject({
      code: "STEP_LOCKED",
    });

    expect(step(await leadChecklist(consultant, lead.id, at), "tu-van").state).toBe("NOT_DONE");
    expect(await prisma.auditEvent.count({ where: { entityId: lead.id, action: "lead.step_locked" } })).toBe(1);
  });

  it("follows the grace parameter, and 0 locks at the deadline", async () => {
    const { consultant, lead } = await assignedLead();
    const admin = (await createTestUser("ADMIN")).actor;
    const first = step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, stepGraceMinutes: "0" });

    await expect(
      completeLeadStep(consultant, lead.id, first.id, { resultIndex: 0 }, new Date(DUE.getTime() + MINUTE)),
    ).rejects.toMatchObject({ code: "STEP_LOCKED" });
  });

  it("records the time of a tick itself, whatever the request says", async () => {
    const { consultant, lead } = await assignedLead();
    const first = step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van");
    const before = Date.now();

    await completeLeadStep(consultant, lead.id, first.id, {
      resultIndex: 0,
      doneAt: "2020-01-01T00:00:00Z",
      timing: "ON_TIME",
    } as never);

    const done = await prisma.leadStep.findUniqueOrThrow({ where: { id: first.id } });
    expect(done.doneAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(done.doneAt!.getFullYear()).toBeGreaterThan(2020);
  });

  it("drops a locked step from today's work", async () => {
    const { consultant, lead } = await assignedLead();
    const at = new Date(DUE.getTime() + 121 * MINUTE);
    expect((await todaySteps(consultant, { scope: "mine" }, at)).items.some((item) => item.lead.id === lead.id)).toBe(
      true,
    );

    await lockOverdueSteps(at);

    expect(
      (await todaySteps(consultant, { scope: "mine" }, at)).items.filter((item) => item.step.key === "tu-van"),
    ).toHaveLength(0);
  });
});

describe("only admin removes a tick, with a reason, and it stays in the history (D-054)", () => {
  async function ticked() {
    const context = await assignedLead();
    const first = step(await leadChecklist(context.consultant, context.lead.id, GIVEN), "tu-van");
    await completeLeadStep(
      context.consultant,
      context.lead.id,
      first.id,
      { resultIndex: 0, note: "Gọi nhầm số" },
      new Date(GIVEN.getTime() + 10 * MINUTE),
    );
    return { ...context, first };
  }
  const OTHER = optionId("stepReopenReasons", "Khác");

  it("opens the step again with a deadline of now at the earliest, and audits who ticked, who removed, and why", async () => {
    const { admin, consultant, lead, first } = await ticked();
    const at = new Date(DUE.getTime() + 30 * MINUTE);

    const checklist = await reopenLeadStep(
      admin,
      lead.id,
      first.id,
      { reasonId: await OTHER, reasonNote: "Tick nhầm khách" },
      at,
    );

    expect(step(checklist, "tu-van")).toMatchObject({
      state: "OPEN",
      doneAt: null,
      doneBy: null,
      result: null,
      timing: null,
      reopenable: false,
      dueAt: at,
    });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.step_reopened" } });
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      before: { step: "tu-van", doneBy: consultant.id, timing: "ON_TIME" },
      after: { step: "tu-van", state: "open" },
      metadata: { reason: "Khác", note: "Tick nhầm khách" },
    });
    // The consultant can tick it right, and it counts as late.
    const again = await completeLeadStep(
      consultant,
      lead.id,
      first.id,
      { resultIndex: 0 },
      new Date(at.getTime() + MINUTE),
    );
    expect(step(again, "tu-van")).toMatchObject({ state: "DONE", timing: "LATE" });
  });

  it("shows a plain tick as one admin may remove, and nobody else is allowed to", async () => {
    const { manager, consultant, lead, first } = await ticked();
    const checklist = await leadChecklist(consultant, lead.id, GIVEN);
    expect(step(checklist, "tu-van").reopenable).toBe(true);

    for (const who of [consultant, manager]) {
      await expect(
        reopenLeadStep(who, lead.id, first.id, { reasonId: await OTHER, reasonNote: "x" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(step(await leadChecklist(consultant, lead.id, GIVEN), "tu-van").state).toBe("DONE");
  });

  it("needs the reason, and the note with Khác", async () => {
    const { admin, lead, first } = await ticked();

    await expect(reopenLeadStep(admin, lead.id, first.id, {})).rejects.toMatchObject({
      fieldErrors: { reasonId: ["required"] },
    });
    await expect(reopenLeadStep(admin, lead.id, first.id, { reasonId: await OTHER })).rejects.toMatchObject({
      fieldErrors: { reasonNote: ["otherNeedsNote"] },
    });
    await expect(
      reopenLeadStep(admin, lead.id, first.id, { reasonId: await optionId("leadSources", "Fanpage"), reasonNote: "x" }),
    ).rejects.toMatchObject({ fieldErrors: { reasonId: ["invalidChoice"] } });
  });

  it("refuses a step that is not done, an unknown step, and a result that moved the lead", async () => {
    const { admin, lead, first } = await ticked();
    const checklist = await leadChecklist(admin, lead.id, GIVEN);
    const reason = { reasonId: await OTHER, reasonNote: "x" };

    await expect(reopenLeadStep(admin, lead.id, step(checklist, "nhac-1").id, reason)).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    await expect(reopenLeadStep(admin, lead.id, "00000000-0000-4000-8000-0000000000aa", reason)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // A result that moved the lead cannot be taken back from here. The migration's template is put back after.
    const row = await prisma.leadStep.findUniqueOrThrow({ where: { id: first.id }, include: { template: true } });
    const original = row.template.results as { labelVi: string; labelEn: string; effect?: string | null }[];
    try {
      await prisma.consultingStepTemplate.update({
        where: { id: row.templateId },
        data: { results: original.map((result, index) => (index === 0 ? { ...result, effect: "REFUSE" } : result)) },
      });
      await expect(reopenLeadStep(admin, lead.id, first.id, reason)).rejects.toMatchObject({
        fieldErrors: { stepId: ["stepMovedTheLead"] },
      });
      expect(step(await leadChecklist(admin, lead.id, GIVEN), "tu-van")).toMatchObject({
        state: "DONE",
        reopenable: false,
      });
    } finally {
      await prisma.consultingStepTemplate.update({ where: { id: row.templateId }, data: { results: original } });
    }
  });
});

describe("the dashboard shows each step's completion and what became of those who did it (D-055)", () => {
  it("counts a step due, done, late, and not done, with the funnel of each group", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    const { actor: consultant } = await createTestUser("CONSULTING");
    const done = await createLead(manager, { fullName: "Đã làm", channelId: WHATSAPP }, GIVEN);
    const missed = await createLead(manager, { fullName: "Bỏ sót", channelId: WHATSAPP }, GIVEN);
    const open = await createLead(
      manager,
      { fullName: "Chưa đến hạn", channelId: WHATSAPP },
      new Date(GIVEN.getTime() + 3 * 60 * MINUTE),
    );
    const first = async (leadId: string) => step(await leadChecklist(consultant, leadId, GIVEN), "tu-van");

    await completeLeadStep(
      consultant,
      done.id,
      (await first(done.id)).id,
      { resultIndex: 0 },
      new Date(DUE.getTime() - MINUTE),
    );
    await prisma.customer.update({ where: { id: done.id }, data: { leadStatus: "BOOKED" } });
    await prisma.leadStatusChange.create({
      data: { customerId: done.id, fromStatus: "CONSULTING", toStatus: "BOOKED", changedAt: new Date(DUE.getTime()) },
    });
    const now = new Date(DUE.getTime() + 3 * 60 * MINUTE);
    await lockOverdueSteps(now);

    const report = await consultingReport(manager, {}, now);

    const row = report.steps.find((entry) => entry.key === "tu-van")!;
    expect(row).toMatchObject({ due: 2, done: 1, onTime: 1, late: 0, notDone: 1, completionRate: 50 });
    // The one who got the step booked, the one who did not did not (D-055).
    expect(row.did).toMatchObject({ leads: 1, bookingRate: 100 });
    expect(row.didNot).toMatchObject({ leads: 1, bookingRate: 0 });
    // The lead whose step is not due yet is not counted.
    expect(row.due + 1).toBe(3);
    expect(open.id).not.toBe(missed.id);
    expect(report.steps.map((entry) => entry.key).slice(0, 2)).toEqual(["tu-van", "nhac-1"]);
  });
});
