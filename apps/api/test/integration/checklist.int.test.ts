import { afterEach, describe, expect, it } from "vitest";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { offsetParts, type ChecklistInput, type LeadChecklist } from "@flow/shared/leads";
import { prisma } from "../../src/platform/db/prisma.js";
import { env } from "../../src/platform/env.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import { assignLead, changeLeadStatus } from "../../src/modules/leads/lead-journey.service.js";
import {
  completeLeadStep,
  getChecklist,
  leadChecklist,
  remindDueSteps,
  saveChecklist,
  todaySteps,
} from "../../src/modules/leads/checklist.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const step = (checklist: LeadChecklist, key: string) => {
  const found = checklist.items.find((item) => item.key === key);
  if (!found) throw new Error(`No step ${key}`);
  return found;
};
const states = (checklist: LeadChecklist) => Object.fromEntries(checklist.items.map((item) => [item.key, item.state]));

/** A lead in the charge of a consultant: created as `manager` at `now`, assigned round-robin. */
async function assignedLead(now = new Date()) {
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: consultant } = await createTestUser("CONSULTING");
  const lead = await createLead(manager, { fullName: "Nguyễn Văn An", channelId: WHATSAPP }, now);
  return { manager, consultant, lead };
}

describe("a lead's checklist (FR-LEAD-004, D-020)", () => {
  it("gets the brief's ten steps; the first opens 60 minutes after assignment", async () => {
    const now = new Date("2030-03-01T02:00:00Z");
    const { consultant, lead } = await assignedLead(now);

    const checklist = await leadChecklist(consultant, lead.id, now);

    expect(checklist.version).toBe(1);
    expect(checklist.items.map((item) => item.key)).toEqual([
      "tu-van",
      "nhac-1",
      "nhac-2",
      "dat-lich",
      "nhac-truoc-hen-1",
      "bao-studio-1",
      "nhac-truoc-hen-2",
      "bao-studio-2",
      "show",
      "tai-cham-soc",
    ]);
    expect(step(checklist, "tu-van")).toMatchObject({
      state: "OPEN",
      dueAt: new Date(now.getTime() + 60 * MINUTE),
      overdue: false,
    });
    expect(Object.values(states(checklist)).filter((state) => state === "WAITING")).toHaveLength(9);
  });

  it("waits for an assignment when nobody receives leads yet", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const lead = await createLead(manager, { fullName: "A", channelId: WHATSAPP });
    expect(step(await leadChecklist(manager, lead.id), "tu-van").state).toBe("WAITING");

    const { actor: consultant } = await createTestUser("CONSULTING");
    await assignLead(manager, lead.id, { userId: consultant.id });
    expect(step(await leadChecklist(manager, lead.id), "tu-van").state).toBe("OPEN");
  });

  it("opens the reminders and re-care with No response, and closes them when the customer replies", async () => {
    const { consultant, lead } = await assignedLead();
    const at = new Date("2030-03-01T03:00:00Z");

    const silent = await changeLeadStatus(consultant, lead.id, { status: "NO_RESPONSE" }, at);
    let checklist = await leadChecklist(consultant, lead.id, at);
    expect(step(checklist, "nhac-1").dueAt).toEqual(new Date(at.getTime() + 60 * MINUTE));
    expect(step(checklist, "nhac-2").dueAt).toEqual(new Date(at.getTime() + 24 * 60 * MINUTE));
    // Re-care is due from the start of the contact-again day (BR-204).
    expect(step(checklist, "tai-cham-soc").dueAt).toEqual(instantAt(silent.contactAgainOn!, "00:00", env.GYM_TIMEZONE));

    await changeLeadStatus(consultant, lead.id, { status: "CONSULTING" }, new Date(at.getTime() + 30 * MINUTE));
    checklist = await leadChecklist(consultant, lead.id, at);
    expect(states(checklist)).toMatchObject({ "nhac-1": "WAITING", "nhac-2": "WAITING", "tai-cham-soc": "WAITING" });
  });

  it("times the visit reminders from the appointment, moves them with it, and drops them when it is called off", async () => {
    const { consultant, lead } = await assignedLead();
    const appointment = (date: string, time: string) =>
      instantAt(new Date(`${date}T00:00:00Z`), time, env.GYM_TIMEZONE);

    await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:00",
    });
    let checklist = await leadChecklist(consultant, lead.id);
    expect(step(checklist, "nhac-truoc-hen-1").dueAt).toEqual(
      new Date(appointment("2030-10-20", "18:00").getTime() - 180 * MINUTE),
    );
    expect(step(checklist, "nhac-truoc-hen-2").dueAt).toEqual(
      new Date(appointment("2030-10-20", "18:00").getTime() - 60 * MINUTE),
    );
    expect(step(checklist, "show").dueAt).toEqual(appointment("2030-10-20", "18:00"));
    // Booking the visit is "Đặt lịch" (A-057): done by whoever booked it, on time.
    expect(step(checklist, "dat-lich")).toMatchObject({
      state: "DONE",
      doneBy: { id: consultant.id },
      result: { labelVi: "Done" },
      timing: "ON_TIME",
    });

    await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "21/10/2030",
      appointmentTime: "07:00",
    });
    checklist = await leadChecklist(consultant, lead.id);
    expect(step(checklist, "show").dueAt).toEqual(appointment("2030-10-21", "07:00"));

    await changeLeadStatus(consultant, lead.id, { status: "CONSULTING" });
    checklist = await leadChecklist(consultant, lead.id);
    expect(states(checklist)).toMatchObject({
      "nhac-truoc-hen-1": "WAITING",
      "nhac-truoc-hen-2": "WAITING",
      show: "WAITING",
      "dat-lich": "DONE",
    });
  });
});

describe("completing a step (FR-LEAD-004)", () => {
  it("records the result, who, when, and whether it was on time, and opens the steps that follow it", async () => {
    const created = new Date("2030-03-01T02:00:00Z");
    const { consultant, lead } = await assignedLead(created);
    await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:00",
    });
    const reminder = step(await leadChecklist(consultant, lead.id), "nhac-truoc-hen-1");
    const doneAt = new Date(reminder.dueAt!.getTime() - MINUTE);

    const checklist = await completeLeadStep(
      consultant,
      lead.id,
      reminder.id,
      { resultIndex: 1, note: "Gọi không nghe" },
      doneAt,
    );

    expect(step(checklist, "nhac-truoc-hen-1")).toMatchObject({
      state: "DONE",
      doneAt,
      doneBy: { id: consultant.id },
      result: { labelVi: "Không phản hồi" },
      note: "Gọi không nghe",
      timing: "ON_TIME",
    });
    // Báo Studio follows right after (brief §4.1).
    expect(step(checklist, "bao-studio-1")).toMatchObject({ state: "OPEN", dueAt: doneAt });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.step_completed" } }),
    ).toMatchObject({
      actorUserId: consultant.id,
      after: { step: "nhac-truoc-hen-1", result: "Không phản hồi", timing: "ON_TIME" },
    });

    const first = step(checklist, "tu-van");
    const late = await completeLeadStep(
      consultant,
      lead.id,
      first.id,
      { resultIndex: 0 },
      new Date(first.dueAt!.getTime() + MINUTE),
    );
    expect(step(late, "tu-van").timing).toBe("LATE");
  });

  it("takes only an open step, once, with one of its own results", async () => {
    const { consultant, lead } = await assignedLead();
    const checklist = await leadChecklist(consultant, lead.id);
    const open = step(checklist, "tu-van");

    await expect(
      completeLeadStep(consultant, lead.id, step(checklist, "nhac-1").id, { resultIndex: 0 }),
    ).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    await expect(completeLeadStep(consultant, lead.id, open.id, { resultIndex: 1 })).rejects.toMatchObject({
      fieldErrors: { resultIndex: ["invalidChoice"] },
    });
    const done = await Promise.allSettled(
      [1, 2].map(() => completeLeadStep(consultant, lead.id, open.id, { resultIndex: 0 })),
    );
    expect(done.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(completeLeadStep(consultant, lead.id, "not-a-uuid", { resultIndex: 0 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is for those who work the lead, on leads they may see (D-017)", async () => {
    const { lead } = await assignedLead();
    const { actor: other } = await createTestUser("CONSULTING");
    const { actor: pt } = await createTestUser("PT");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const open = step(await leadChecklist(reception, lead.id), "tu-van");

    await expect(leadChecklist(other, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeLeadStep(other, lead.id, open.id, { resultIndex: 0 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(completeLeadStep(pt, lead.id, open.id, { resultIndex: 0 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(completeLeadStep(reception, lead.id, open.id, { resultIndex: 0 })).resolves.toBeDefined();
  });
});

describe('"Việc hôm nay" (FR-LEAD-005)', () => {
  it("lists my open steps due by the end of today, oldest deadline first, and counts the overdue", async () => {
    // 10:00 in the gym's time zone: the steps due within the hour are still today's.
    const now = new Date("2030-03-01T03:00:00Z");
    const { manager, consultant } = await assignedLead(new Date(now.getTime() - 2 * 60 * MINUTE));
    const second = await createLead(manager, { fullName: "Lê Hoa", channelId: WHATSAPP }, now);
    // A booking far ahead: its reminders are not today's.
    await changeLeadStatus(
      consultant,
      second.id,
      { status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:00" },
      now,
    );

    const today = await todaySteps(consultant, {}, now);

    expect(today.items.map((item) => [item.lead.fullName, item.step.key])).toEqual([
      ["Nguyễn Văn An", "tu-van"],
      ["Lê Hoa", "tu-van"],
    ]);
    expect(today.overdue).toBe(1);
    expect(today.items[0].step.overdue).toBe(true);
    // Mine is the consultant's; the manager in charge of nothing sees them under "all".
    expect((await todaySteps(manager, {}, now)).items).toEqual([]);
    expect((await todaySteps(manager, { scope: "all" }, now)).items).toHaveLength(2);
    const { actor: other } = await createTestUser("CONSULTING");
    expect((await todaySteps(other, { scope: "all" }, now)).items).toEqual([]);
    await expect(todaySteps(consultant, { scope: "team" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("tells the person in charge once when a step comes due, and again for a new deadline", async () => {
    const created = new Date("2030-03-01T02:00:00Z");
    const { consultant, lead } = await assignedLead(created);
    const due = new Date(created.getTime() + 60 * MINUTE);

    expect(await remindDueSteps(new Date(due.getTime() - MINUTE))).toBe(0);
    expect(await remindDueSteps(due)).toBe(1);
    expect(await remindDueSteps(new Date(due.getTime() + MINUTE))).toBe(0);
    const told = await prisma.notification.findMany({ where: { userId: consultant.id, kind: "leadStepDue" } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      params: { code: lead.leadCode, name: "Nguyễn Văn An", stepVi: "Tư vấn sản phẩm phù hợp" },
      link: `/leads/${lead.id}`,
    });
  });
});

describe("editing the checklist (D-020)", () => {
  const v1Steps = async (actor: Parameters<typeof getChecklist>[0]): Promise<ChecklistInput["steps"]> =>
    (await getChecklist(actor)).steps.map((s) => ({
      key: s.key,
      labelVi: s.labelVi,
      labelEn: s.labelEn,
      trigger: s.trigger,
      triggerStatus: s.triggerStatus ?? "",
      triggerStepKey: s.triggerStepKey ?? "",
      ...offsetParts(s.offsetMinutes),
      required: s.required,
      autoComplete: s.autoComplete,
      results: s.results,
    }));

  it("saves a new version for new leads; leads already started keep theirs", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { manager, consultant, lead: before } = await assignedLead();
    const steps = await v1Steps(admin);
    steps[0] = { ...steps[0], labelVi: "Tư vấn (mới)", offsetValue: 2, offsetUnit: "HOURS" };

    const saved = await saveChecklist(admin, { steps: steps.slice(0, 9) });

    expect(saved).toMatchObject({ version: 2, createdBy: { id: admin.id } });
    expect(saved.steps).toHaveLength(9);
    const after = await createLead(manager, { fullName: "Sau", channelId: WHATSAPP });
    const newer = await leadChecklist(consultant, after.id);
    expect(newer.version).toBe(2);
    expect(step(newer, "tu-van")).toMatchObject({ labelVi: "Tư vấn (mới)", offsetMinutes: 120 });
    const older = await leadChecklist(consultant, before.id);
    expect(older.version).toBe(1);
    expect(older.items).toHaveLength(10);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          entityType: "consulting_checklist",
          entityId: (await prisma.consultingChecklist.findUniqueOrThrow({ where: { version: 2 } })).id,
        },
      }),
    ).toMatchObject({
      action: "consulting_checklist.created",
      before: { version: 1 },
      after: { version: 2 },
    });
  });

  it("is configuration: only config.manage, and checked", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const steps = await v1Steps(admin);

    await expect(getChecklist(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveChecklist(manager, { steps })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveChecklist(admin, { steps: [{ ...steps[5], triggerStepKey: "khong-co" }] })).rejects.toMatchObject({
      fieldErrors: { steps: ["invalidChoice"] },
    });
    const versions = await Promise.all([1, 2].map(() => saveChecklist(admin, { steps })));
    expect(versions.map((v) => v.version).sort()).toEqual([2, 3]);
  });
});

describe("dates", () => {
  it("counts a re-care day from the gym's today", async () => {
    const { consultant, lead } = await assignedLead();
    const refused = await changeLeadStatus(consultant, lead.id, { status: "NO_RESPONSE" });
    expect(refused.contactAgainOn).toEqual(new Date(calendarDateInTimeZone(env.GYM_TIMEZONE).getTime() + 15 * DAY_MS));
  });
});
