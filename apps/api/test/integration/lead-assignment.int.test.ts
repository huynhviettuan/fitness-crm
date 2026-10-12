import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import { leadTimeline } from "../../src/modules/leads/lead-journey.service.js";
import { completeLeadStep, leadChecklist } from "../../src/modules/leads/checklist.service.js";
import { listLeadReceivers, setLeadReceiver } from "../../src/modules/leads/lead-receiver.service.js";
import { reclaimLeads } from "../../src/modules/leads/lead-reclaim.service.js";
import { addLeadNote } from "../../src/modules/leads/lead-note.service.js";
import { consultingReport } from "../../src/modules/reports/report.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, inRoundRobinOrder, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const MINUTE = 60_000;
// 2026-10-12 is a Monday; the gym's day runs on UTC+7.
const at = (day: number, time: string) => new Date(`2026-10-${String(day).padStart(2, "0")}T${time}:00+07:00`);

async function team(...weights: number[]) {
  const consultants = [];
  for (let n = 0; n < weights.length; n += 1) consultants.push(await createTestUser("CONSULTING"));
  await inRoundRobinOrder(...consultants.map((c) => c.user.id));
  for (const [index, { user }] of consultants.entries()) {
    await prisma.user.update({ where: { id: user.id }, data: { leadWeight: weights[index] } });
  }
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  return { consultants: consultants.map((c) => c.actor), reception };
}

const lead = (reception: Awaited<ReturnType<typeof team>>["reception"], name: string, now: Date) =>
  createLead(reception, { fullName: name, channelId: WHATSAPP }, now);

describe("leads are dealt by turn weight (D-050)", () => {
  it("gives a full-timer with weight 2 two leads in each round of three, and a part-timer one", async () => {
    const { consultants, reception } = await team(2, 1);

    const dealt: string[] = [];
    for (let n = 0; n < 6; n += 1) dealt.push((await lead(reception, `Lead ${n}`, at(12, "10:00"))).pic!.id);

    const [full, part] = consultants;
    expect(dealt).toEqual([full.id, part.id, full.id, full.id, part.id, full.id]);
  });

  it("goes round in turn when everybody has weight 1", async () => {
    const { consultants, reception } = await team(1, 1, 1);

    const dealt: string[] = [];
    for (let n = 0; n < 4; n += 1) dealt.push((await lead(reception, `Lead ${n}`, at(12, "10:00"))).pic!.id);

    expect(dealt).toEqual([consultants[0].id, consultants[1].id, consultants[2].id, consultants[0].id]);
  });

  it("skips a consultant whose receiving is off, and takes them back when it is on again", async () => {
    const { consultants, reception } = await team(1, 1);
    await prisma.user.update({ where: { id: consultants[1].id }, data: { receivesLeads: false } });

    const first = await lead(reception, "A", at(12, "10:00"));
    const second = await lead(reception, "B", at(12, "10:00"));
    expect([first.pic!.id, second.pic!.id]).toEqual([consultants[0].id, consultants[0].id]);

    await prisma.user.update({ where: { id: consultants[1].id }, data: { receivesLeads: true } });
    const next = await Promise.all([lead(reception, "C", at(12, "10:00")), lead(reception, "D", at(12, "10:00"))]);
    expect(new Set(next.map((l) => l.pic!.id))).toEqual(new Set([consultants[0].id, consultants[1].id]));
  });

  it("leaves the lead New for the managers when nobody receives leads", async () => {
    const { consultants, reception } = await team(1);
    await prisma.user.update({ where: { id: consultants[0].id }, data: { receivesLeads: false } });

    const created = await lead(reception, "Không ai nhận", at(12, "10:00"));

    expect(created).toMatchObject({ pic: null, status: "NEW" });
  });

  it("gives leads only to those within their working hours, and to the next in turn when nobody is", async () => {
    const { consultants, reception } = await team(1, 1);
    // The first consultant works only on Tuesdays; it is Monday 10:00.
    await prisma.userAccessWindow.create({
      data: { userId: consultants[0].id, weekdays: [2], startTime: "08:00", endTime: "18:00" },
    });

    const onDuty = await Promise.all([lead(reception, "A", at(12, "10:00")), lead(reception, "B", at(12, "10:00"))]);
    expect(onDuty.map((l) => l.pic!.id)).toEqual([consultants[1].id, consultants[1].id]);

    await prisma.userAccessWindow.create({
      data: { userId: consultants[1].id, weekdays: [2], startTime: "08:00", endTime: "18:00" },
    });
    const nobody = await lead(reception, "C", at(12, "10:00"));
    expect(nobody.pic).not.toBeNull();
    const tuesday = await lead(reception, "D", at(13, "10:00"));
    expect([consultants[0].id, consultants[1].id]).toContain(tuesday.pic!.id);
  });

  it("records a round-robin assignment as such on the timeline", async () => {
    const { reception } = await team(1);

    const created = await lead(reception, "Một", at(12, "10:00"));
    const timeline = await leadTimeline(reception, created.id);

    expect(timeline.items.find((item) => item.kind === "assignment")).toMatchObject({
      how: "ROUND_ROBIN",
      waitedMinutes: null,
    });
  });
});

describe("an untouched lead moves on to the next consultant (D-052)", () => {
  it("moves after an hour of working time, keeps the move, and tells the people concerned", async () => {
    const { consultants, reception } = await team(1, 1);
    const [first, second] = consultants;
    const created = await lead(reception, "Không ai gọi", at(12, "10:00"));
    expect(created.pic!.id).toBe(first.id);

    expect(await reclaimLeads(at(12, "10:59"))).toBe(0);
    expect(await reclaimLeads(at(12, "11:01"))).toBe(1);
    // Moved once: nothing more to do a minute later, and the clock starts again.
    expect(await reclaimLeads(at(12, "11:02"))).toBe(0);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.picUserId).toBe(second.id);
    const timeline = await leadTimeline(reception, created.id);
    const move = timeline.items.find((item) => item.kind === "assignment" && item.how === "RECLAIM");
    expect(move).toMatchObject({ from: { id: first.id }, to: { id: second.id }, by: null, waitedMinutes: 61 });
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: created.id, action: "lead.assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toMatchObject({ actorUserId: null, metadata: { assignment: "reclaim", waitedMinutes: 61 } });
    const told = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId }, select: { kind: true, params: true } })).map(
        (n) => n.kind,
      );
    expect(await told(first.id)).toContain("leadReclaimed");
    expect(await told(second.id)).toContain("leadAssigned");
  });

  it("stops the clock outside 08:30–20:30: a lead given at 20:00 has 30 minutes at 20:30 and 30 more from 08:30", async () => {
    const { consultants, reception } = await team(1, 1);
    const created = await lead(reception, "Tối muộn", at(12, "20:00"));
    const owner = created.pic!.id;

    expect(await reclaimLeads(at(12, "23:00"))).toBe(0);
    expect(await reclaimLeads(at(13, "08:30"))).toBe(0);
    expect(await reclaimLeads(at(13, "08:59"))).toBe(0);
    expect(await reclaimLeads(at(13, "09:00"))).toBe(1);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.picUserId).not.toBe(owner);
    expect(consultants.map((c) => c.id)).toContain(after.picUserId);
  });

  it("does not move a lead whose consultant did the first step, wrote a note, or moved it", async () => {
    const { consultants, reception } = await team(1, 1, 1);
    const stepDone = await lead(reception, "Đã tư vấn", at(12, "10:00"));
    const noted = await lead(reception, "Có ghi chú", at(12, "10:00"));
    const idle = await lead(reception, "Bỏ quên", at(12, "10:00"));
    const owner = (id: string) => consultants.find((c) => c.id === id)!;

    const checklist = await leadChecklist(owner(stepDone.pic!.id), stepDone.id);
    const first = checklist.items.find((item) => item.key === "tu-van")!;
    await completeLeadStep(owner(stepDone.pic!.id), stepDone.id, first.id, { resultIndex: 0 }, at(12, "10:20"));
    await addLeadNote(owner(noted.pic!.id), noted.id, { body: "Đã nhắn Zalo" });
    await prisma.leadNote.updateMany({ data: { createdAt: at(12, "10:30") } });

    expect(await reclaimLeads(at(12, "12:00"))).toBe(1);

    const where = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).picUserId;
    expect(await where(stepDone.id)).toBe(stepDone.pic!.id);
    expect(await where(noted.id)).toBe(noted.pic!.id);
    expect(await where(idle.id)).not.toBe(idle.pic!.id);
  });

  it("goes on by the turn: the next consultant, never the one it is taken from, and nobody else means it waits", async () => {
    const { consultants, reception } = await team(1);
    const created = await lead(reception, "Một mình", at(12, "10:00"));

    expect(await reclaimLeads(at(12, "13:00"))).toBe(0);

    expect((await prisma.customer.findUniqueOrThrow({ where: { id: created.id } })).picUserId).toBe(consultants[0].id);
    expect(await prisma.leadAssignment.count({ where: { kind: "RECLAIM" } })).toBe(0);
  });

  it("follows the time limit parameter, and 0 switches it off", async () => {
    const admin = (await createTestUser("ADMIN")).actor;
    const { reception } = await team(1, 1);
    await lead(reception, "Đổi tham số", at(12, "10:00"));

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, reclaimMinutes: "0" });
    expect(await reclaimLeads(at(12, "18:00"))).toBe(0);
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, reclaimMinutes: "120" });
    expect(await reclaimLeads(at(12, "11:59"))).toBe(0);
    expect(await reclaimLeads(at(12, "12:01"))).toBe(1);
  });

  it("follows the working window parameter: a window that opens later counts only from its start", async () => {
    const admin = (await createTestUser("ADMIN")).actor;
    const { reception } = await team(1, 1);
    await lead(reception, "Cửa sổ muộn", at(13, "07:00"));

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, consultingWindowStart: "09:00" });
    expect(await reclaimLeads(at(13, "09:30"))).toBe(0);
    expect(await reclaimLeads(at(13, "10:01"))).toBe(1);
  });

  it("is told on the consulting dashboard as moves per person in the period, and the team's total", async () => {
    const { consultants, reception } = await team(1, 1);
    const admin = (await createTestUser("ADMIN", { allBranches: true })).actor;
    await lead(reception, "Một", at(12, "10:00"));
    await lead(reception, "Hai", at(12, "10:00"));
    await reclaimLeads(at(12, "11:30"));

    const report = await consultingReport(admin, { from: "12/10/2026", to: "12/10/2026" }, at(12, "12:00"));

    const row = (id: string) => report.items.find((item) => item.consultant?.id === id);
    expect(row(consultants[0].id)?.reclaimed).toBe(1);
    expect(row(consultants[1].id)?.reclaimed).toBe(1);
    expect(report.team.reclaimed).toBe(2);
    // A period without the moves counts none.
    const other = await consultingReport(admin, { from: "13/10/2026", to: "13/10/2026" }, at(13, "12:00"));
    expect(other.team.reclaimed).toBe(0);
  });
});

describe("who receives leads, and how often (D-050)", () => {
  it("lists the consultants of the manager's branches with their weight and the switch", async () => {
    const { consultants } = await team(2, 1);
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const { items } = await listLeadReceivers(manager, at(12, "10:00"));

    expect(items.map((item) => [item.id, item.leadWeight, item.receivesLeads, item.onDuty])).toEqual(
      expect.arrayContaining([
        [consultants[0].id, 2, true, true],
        [consultants[1].id, 1, true, true],
      ]),
    );
    // Nobody who does not receive leads is listed.
    expect(items.some((item) => item.role.name === "Lễ tân")).toBe(false);
  });

  it("sets the switch and the weight, audits the change, and refuses a weight out of range or an outsider", async () => {
    const { consultants } = await team(1);
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const changed = await setLeadReceiver(manager, consultants[0].id, { receivesLeads: false, leadWeight: 3 });

    expect(changed).toMatchObject({ receivesLeads: false, leadWeight: 3 });
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: consultants[0].id, action: "user.lead_reception_changed" },
    });
    expect(audit).toMatchObject({
      actorUserId: manager.id,
      before: { receivesLeads: true, leadWeight: 1 },
      after: { receivesLeads: false, leadWeight: 3 },
    });
    await expect(
      setLeadReceiver(manager, consultants[0].id, { receivesLeads: true, leadWeight: 0 }),
    ).rejects.toMatchObject({
      fieldErrors: { leadWeight: ["outOfRange"] },
    });
    await expect(
      setLeadReceiver(manager, consultants[0].id, { receivesLeads: true, leadWeight: 21 }),
    ).rejects.toMatchObject({
      fieldErrors: { leadWeight: ["outOfRange"] },
    });
    // Someone who does not receive leads is not a receiver: not found.
    await expect(setLeadReceiver(manager, manager.id, { receivesLeads: true, leadWeight: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is for those who reassign leads: a consultant and a receptionist are refused", async () => {
    const { consultants, reception } = await team(1);

    await expect(listLeadReceivers(consultants[0])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setLeadReceiver(reception, consultants[0].id, { receivesLeads: false, leadWeight: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: consultants[0].id } })).receivesLeads).toBe(true);
  });
});

describe("the minutes are not time-zone tricks", () => {
  it("counts a lead given a few minutes before the window opens from the opening", async () => {
    const { reception } = await team(1, 1);
    await lead(reception, "Sớm", at(12, "08:00"));

    expect(await reclaimLeads(at(12, "09:20"))).toBe(0);
    expect(await reclaimLeads(at(12, "09:31"))).toBe(1);
    expect(MINUTE).toBe(60_000);
  });
});
