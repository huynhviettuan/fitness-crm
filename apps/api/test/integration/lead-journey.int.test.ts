import { afterEach, describe, expect, it } from "vitest";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { env } from "../../src/platform/env.js";
import { createLead, getLead, leadBoard } from "../../src/modules/leads/lead.service.js";
import {
  assignLead,
  changeLeadStatus,
  leadAssignees,
  leadTimeline,
} from "../../src/modules/leads/lead-journey.service.js";
import { otherNotes } from "../../src/platform/options/option.service.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { resetDatabase } from "../support/database.js";
import {
  createTestBranch,
  createTestOption,
  createTestUser,
  inRoundRobinOrder,
  optionId,
} from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const ZALO = await optionId("leadChannels", "Zalo");
const OTHER_REASON = await optionId("leadRefuseReasons", "Khác");
const DAY_MS = 86_400_000;

const newLead = (
  actor: Parameters<typeof createLead>[0],
  fullName = "Nguyễn Văn An",
  extra: Record<string, unknown> = {},
) => createLead(actor, { fullName, channelId: WHATSAPP, ...extra });
const kindsOf = async (userId: string) =>
  (
    await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { kind: true } })
  ).map((n) => n.kind);
const gymToday = () => calendarDateInTimeZone(env.GYM_TIMEZONE);

describe("round-robin assignment (BR-203, AC-06)", () => {
  it("hands new leads to the branch's consultants in turn, starting them Consulting", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const consultants = await Promise.all([1, 2, 3].map(() => createTestUser("CONSULTING").then(({ actor }) => actor)));
    await inRoundRobinOrder(...consultants.map((c) => c.id));

    const leads = [];
    for (const name of ["A", "B", "C", "D"]) leads.push(await newLead(reception, name));

    expect(leads.map((lead) => lead.pic?.id)).toEqual([
      consultants[0].id,
      consultants[1].id,
      consultants[2].id,
      consultants[0].id,
    ]);
    expect(leads.map((lead) => lead.status)).toEqual(["CONSULTING", "CONSULTING", "CONSULTING", "CONSULTING"]);
    // One instant: created, then assigned by the round-robin, then Consulting.
    const timeline = await leadTimeline(reception, leads[0].id);
    expect(
      timeline.items.map((entry) => (entry.kind === "status" ? `${entry.fromStatus}→${entry.toStatus}` : "assigned")),
    ).toEqual(["NEW→CONSULTING", "assigned", "null→NEW"]);
    expect(timeline.items.map((entry) => entry.by?.id ?? null)).toEqual([null, null, reception.id]);
    const assignment = await prisma.leadAssignment.findFirst({ where: { customerId: leads[0].id } });
    expect(assignment).toMatchObject({ fromUserId: null, toUserId: consultants[0].id, assignedById: null });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: leads[0].id, action: "lead.assigned" } }),
    ).toMatchObject({
      actorUserId: reception.id,
      before: { picUserId: null, leadStatus: "NEW" },
      after: { picUserId: consultants[0].id, leadStatus: "CONSULTING" },
      metadata: { assignment: "roundRobin" },
    });
  });

  it("tells the consultant, and the branch's lead managers except whoever added it", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const { actor: elsewhere } = await createTestUser("FITNESS_MANAGER", {
      branchIds: [(await createTestBranch()).id],
    });

    const lead = await newLead(manager, "Trần Mai");

    expect(await kindsOf(consultant.id)).toEqual(["leadAssigned"]);
    expect(await kindsOf(admin.id)).toEqual(["leadNew"]);
    expect(await kindsOf(manager.id)).toEqual([]);
    expect(await kindsOf(elsewhere.id)).toEqual([]);
    const told = await prisma.notification.findFirst({ where: { userId: consultant.id } });
    expect(told).toMatchObject({ params: { code: lead.leadCode, name: "Trần Mai" }, link: `/leads/${lead.id}` });
  });

  it("counts only active users of the branch who receive leads, overrides included (D-017)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const other = await createTestBranch();
    const { actor: disabled } = await createTestUser("CONSULTING");
    const { actor: otherBranch } = await createTestUser("CONSULTING", { branchIds: [other.id] });
    const { actor: denied } = await createTestUser("CONSULTING");
    const { actor: granted } = await createTestUser("RECEPTIONIST");
    const { actor: everywhere } = await createTestUser("CONSULTING", { allBranches: true, branchIds: [] });
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    await prisma.userPermissionOverride.createMany({
      data: [
        { userId: denied.id, permission: "lead.receive", granted: false },
        { userId: granted.id, permission: "lead.receive", granted: true },
      ],
    });
    await inRoundRobinOrder(disabled.id, otherBranch.id, denied.id, granted.id, everywhere.id);

    const picks = [];
    for (const name of ["A", "B", "C"]) picks.push((await newLead(admin, name)).pic?.id);

    expect(picks).toEqual([granted.id, everywhere.id, granted.id]);
  });

  it("keeps a lead New when nobody receives leads, and still tells the managers", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const lead = await newLead(reception);

    expect(lead).toMatchObject({ status: "NEW", pic: null });
    expect(await kindsOf(manager.id)).toEqual(["leadNew"]);
  });

  it("goes on after the last receiver leaves the turn", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => createTestUser("CONSULTING").then(({ actor }) => actor)));
    await inRoundRobinOrder(a.id, b.id, c.id);
    await newLead(reception, "1");
    await newLead(reception, "2");
    await prisma.user.update({ where: { id: b.id }, data: { status: "DISABLED" } });

    expect((await newLead(reception, "3")).pic?.id).toBe(c.id);
    expect((await newLead(reception, "4")).pic?.id).toBe(a.id);
  });

  it("deals evenly when leads arrive at once", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const [a, b] = await Promise.all([1, 2].map(() => createTestUser("CONSULTING").then(({ actor }) => actor)));

    const leads = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => newLead(reception, `Lead ${n}`)));

    const countOf = (userId: string) => leads.filter((lead) => lead.pic?.id === userId).length;
    expect([countOf(a.id), countOf(b.id)]).toEqual([3, 3]);
  });
});

describe("reassigning a lead (BR-203)", () => {
  it("lets a manager hand it to another consultant, recorded and told", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const [first, second] = await Promise.all(
      [1, 2].map(() => createTestUser("CONSULTING", { name: `Tư vấn` }).then(({ actor }) => actor)),
    );
    await inRoundRobinOrder(first.id, second.id);
    const lead = await newLead(manager);

    const moved = await assignLead(manager, lead.id, { userId: second.id });

    expect(moved).toMatchObject({ pic: { id: second.id }, status: "CONSULTING" });
    expect(
      await prisma.leadAssignment.findFirst({ where: { customerId: lead.id, assignedById: manager.id } }),
    ).toMatchObject({
      fromUserId: first.id,
      toUserId: second.id,
    });
    expect(await kindsOf(second.id)).toEqual(["leadAssigned"]);
    // Giving it to its person in charge again changes nothing.
    await assignLead(manager, lead.id, { userId: second.id });
    expect(await prisma.leadAssignment.count({ where: { customerId: lead.id } })).toBe(2);
  });

  it("starts a New lead Consulting", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const lead = await newLead(manager);
    const { actor: consultant } = await createTestUser("CONSULTING");

    expect(await assignLead(manager, lead.id, { userId: consultant.id })).toMatchObject({
      status: "CONSULTING",
      pic: { id: consultant.id },
    });
    const timeline = await leadTimeline(manager, lead.id);
    expect(
      timeline.items.map((entry) =>
        entry.kind === "status"
          ? `${entry.fromStatus}→${entry.toStatus}`
          : entry.kind === "assignment"
            ? `→${entry.to.id}`
            : entry.kind,
      ),
    ).toEqual(["NEW→CONSULTING", `→${consultant.id}`, "null→NEW"]);
    expect(timeline.items[0].by?.id).toBe(manager.id);
  });

  it("gives it only to someone of its branch who receives leads, and only managers reassign", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING", { name: "Bảo" });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: elsewhere } = await createTestUser("CONSULTING", { branchIds: [(await createTestBranch()).id] });
    const lead = await newLead(reception);

    await expect(assignLead(manager, lead.id, { userId: reception.id })).rejects.toMatchObject({
      fieldErrors: { userId: ["invalidChoice"] },
    });
    await expect(assignLead(manager, lead.id, { userId: elsewhere.id })).rejects.toMatchObject({
      fieldErrors: { userId: ["invalidChoice"] },
    });
    await expect(assignLead(consultant, lead.id, { userId: consultant.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(leadAssignees(reception, lead.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await leadAssignees(manager, lead.id)).toEqual({ items: [{ id: consultant.id, name: "Bảo" }] });
  });
});

describe("moving a lead along its journey (D-020)", () => {
  async function consultingLead() {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(manager);
    return { manager, consultant, lead };
  }

  it("follows the flow, records who and when, and audits it", async () => {
    const { consultant, lead } = await consultingLead();

    const considering = await changeLeadStatus(consultant, lead.id, { status: "CONSIDERING", note: "Hỏi lại vợ" });

    expect(considering).toMatchObject({ status: "CONSIDERING", appointmentAt: null, contactAgainOn: null });
    expect(considering.statusChangedAt.getTime()).toBeGreaterThan(lead.statusChangedAt.getTime() - 1);
    expect(
      await prisma.leadStatusChange.findFirst({ where: { customerId: lead.id, toStatus: "CONSIDERING" } }),
    ).toMatchObject({
      fromStatus: "CONSULTING",
      changedById: consultant.id,
      note: "Hỏi lại vợ",
    });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.status_changed" } }),
    ).toMatchObject({
      actorUserId: consultant.id,
      before: { leadStatus: "CONSULTING" },
      after: { leadStatus: "CONSIDERING" },
      metadata: { note: "Hỏi lại vợ" },
    });
  });

  it("refuses a move the flow does not allow, and the same move twice", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const unassigned = await newLead(manager);
    await expect(changeLeadStatus(manager, unassigned.id, { status: "CONSIDERING" })).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });

    const { consultant, lead } = await consultingLead();
    const moves = await Promise.allSettled(
      [1, 2].map(() => changeLeadStatus(consultant, lead.id, { status: "NO_RESPONSE" })),
    );

    expect(moves.map((move) => move.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(moves.find((move) => move.status === "rejected")).toMatchObject({
      reason: { code: "INVALID_STATUS_TRANSITION" },
    });
    expect(await prisma.leadStatusChange.count({ where: { customerId: lead.id, toStatus: "NO_RESPONSE" } })).toBe(1);
  });

  it("books an appointment in the future, moves it, and drops it when the lead goes back", async () => {
    const { consultant, lead } = await consultingLead();

    await expect(
      changeLeadStatus(consultant, lead.id, {
        status: "BOOKED",
        appointmentDate: "01/01/2020",
        appointmentTime: "09:00",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { appointmentDate: ["notInFuture"] },
    });
    const booked = await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:30",
    });
    expect(booked.appointmentAt).toEqual(instantAt(new Date(Date.UTC(2030, 9, 20)), "18:30", env.GYM_TIMEZONE));
    const moved = await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "21/10/2030",
      appointmentTime: "07:00",
    });
    expect(moved.appointmentAt).toEqual(instantAt(new Date(Date.UTC(2030, 9, 21)), "07:00", env.GYM_TIMEZONE));
    expect(await changeLeadStatus(consultant, lead.id, { status: "CONSULTING" })).toMatchObject({
      appointmentAt: null,
    });
    expect(
      await prisma.leadStatusChange.findFirst({
        where: { customerId: lead.id, fromStatus: "BOOKED", toStatus: "BOOKED" },
      }),
    ).toMatchObject({
      appointmentAt: moved.appointmentAt,
    });
  });

  it("needs a reason to refuse, Khác with a note, and sets the day to contact them again (BR-204)", async () => {
    const { consultant, lead } = await consultingLead();
    const tooFar = await createTestOption("leadRefuseReasons", "Nhà xa");

    await expect(changeLeadStatus(consultant, lead.id, { status: "REFUSED" })).rejects.toMatchObject({
      fieldErrors: { refuseReasonId: ["required"] },
    });
    await expect(
      changeLeadStatus(consultant, lead.id, { status: "REFUSED", refuseReasonId: OTHER_REASON }),
    ).rejects.toMatchObject({
      fieldErrors: { refuseReasonNote: ["otherNeedsNote"] },
    });
    await expect(
      changeLeadStatus(consultant, lead.id, { status: "REFUSED", refuseReasonId: WHATSAPP }),
    ).rejects.toMatchObject({
      fieldErrors: { refuseReasonId: ["invalidChoice"] },
    });

    const refused = await changeLeadStatus(consultant, lead.id, { status: "REFUSED", refuseReasonId: tooFar });
    expect(refused).toMatchObject({ status: "REFUSED", refuseReason: { id: tooFar, labelVi: "Nhà xa" } });
    expect(refused.contactAgainOn).toEqual(new Date(gymToday().getTime() + 15 * DAY_MS));

    const back = await changeLeadStatus(consultant, lead.id, { status: "CONSULTING" });
    expect(back).toMatchObject({ refuseReason: null, contactAgainOn: null });

    await updateParameters((await createTestUser("ADMIN")).actor, { ...PARAMETER_DEFAULTS, recareDays: "7" });
    const silent = await changeLeadStatus(consultant, lead.id, { status: "NO_RESPONSE" });
    expect(silent.contactAgainOn).toEqual(new Date(gymToday().getTime() + 7 * DAY_MS));
  });

  it("lists the notes written with Khác for admin (FR-PLT-005)", async () => {
    const { consultant, lead } = await consultingLead();
    const { actor: admin } = await createTestUser("ADMIN");
    await changeLeadStatus(consultant, lead.id, {
      status: "REFUSED",
      refuseReasonId: OTHER_REASON,
      refuseReasonNote: "Đã có PT riêng",
    });

    expect(await otherNotes(admin, "leadRefuseReasons")).toMatchObject([{ note: "Đã có PT riêng", count: 1 }]);
  });

  it("is for those who work leads, on leads they may see (D-017)", async () => {
    const { lead } = await consultingLead();
    const { actor: anotherConsultant } = await createTestUser("CONSULTING");
    const { actor: pt } = await createTestUser("PT");
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    await expect(changeLeadStatus(anotherConsultant, lead.id, { status: "CONSIDERING" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(leadTimeline(anotherConsultant, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeLeadStatus(pt, lead.id, { status: "CONSIDERING" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeLeadStatus(reception, lead.id, { status: "CONSIDERING" })).resolves.toMatchObject({
      status: "CONSIDERING",
    });
    await expect(changeLeadStatus(reception, "not-a-uuid", { status: "CONSIDERING" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the Kanban board (FR-LEAD-006)", () => {
  it("has a column per lead status with its total, filtered like the list", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const unassigned = await newLead(manager, "Chưa ai nhận");
    // From now on leads go to the consultant.
    const { actor: consultant } = await createTestUser("CONSULTING");
    const late = await newLead(manager, "Hẹn muộn", { channelId: ZALO });
    const early = await newLead(manager, "Hẹn sớm");
    await changeLeadStatus(consultant, late.id, {
      status: "BOOKED",
      appointmentDate: "22/10/2030",
      appointmentTime: "10:00",
    });
    await changeLeadStatus(consultant, early.id, {
      status: "BOOKED",
      appointmentDate: "21/10/2030",
      appointmentTime: "10:00",
    });

    const board = await leadBoard(manager, {});
    expect(board.columns.map((column) => column.status)).toEqual([
      "NEW",
      "CONSULTING",
      "CONSIDERING",
      "NO_RESPONSE",
      "BOOKED",
      "NO_SHOW",
      "REFUSED",
    ]);
    const column = (status: string) => board.columns.find((c) => c.status === status);
    expect(column("BOOKED")).toMatchObject({ total: 2, items: [{ id: early.id }, { id: late.id }] });
    expect(column("CONSULTING")?.total).toBe(0);

    const zalo = await leadBoard(manager, { channelId: ZALO });
    expect(zalo.columns.flatMap((c) => c.items.map((lead) => lead.id))).toEqual([late.id]);
    // A consultant sees only their own leads.
    const own = await leadBoard(consultant, {});
    expect(own.columns.flatMap((c) => c.items.map((lead) => lead.id)).sort()).toEqual([early.id, late.id].sort());
    expect((await getLead(manager, unassigned.id)).status).toBe("NEW");
  });
});
