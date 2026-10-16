import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@gymcrm/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import {
  consultantAudit,
  leadAudit,
  leadsToCheck,
  listCriteria,
  updateCriteria,
} from "../../src/modules/leads/lead-audit.service.js";
import { resetDatabase } from "../support/database.js";
import { actorOf, createTestBranch, createTestUser, inRoundRobinOrder, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

// The automatic consulting audit (brief §4.1, FR-LEAD-011; A-081 to A-085; AC-07, late steps count).

afterEach(resetDatabase);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ALL = Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])) as Record<
  (typeof DATA_SCOPE_RESOURCES)[number],
  "ALL" | "OWN"
>;

/** The first step ("tư vấn") opens when the lead is assigned; the others wait for their triggers. */
type FirstStep = "onTime" | "late" | "openLate" | "openAhead";

/** Puts the lead's first step into the state a test needs, with its fields as given. */
async function setFirstStep(leadId: string, state: FirstStep) {
  const now = Date.now();
  const data = {
    onTime: { dueAt: new Date(now + HOUR), doneAt: new Date(now), timing: "ON_TIME" as const },
    late: { dueAt: new Date(now - 2 * HOUR), doneAt: new Date(now), timing: "LATE" as const },
    openLate: { dueAt: new Date(now - HOUR), doneAt: null, timing: null },
    openAhead: { dueAt: new Date(now + HOUR), doneAt: null, timing: null },
  }[state];
  await prisma.leadStep.updateMany({ where: { customerId: leadId, template: { key: "tu-van" } }, data });
}

/** A lead with a phone and no need group (so one criterion fails), its first step set as asked. */
async function lead(name: string, state: FirstStep, extra: Record<string, unknown> = {}) {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const created = await newLead(reception, name, extra);
  await setFirstStep(created.id, state);
  return created;
}

const manager = () => createTestUser("FITNESS_MANAGER").then(({ actor }) => actor);

/** A user whose role holds exactly these permissions. */
async function userWith(permissions: string[], fieldMasks: string[] = [], branchIds?: string[]) {
  const { actor: admin } = await createTestUser("ADMIN");
  const role = await createRole(admin, {
    name: `Vai trò ${randomUUID().slice(0, 8)}`,
    permissions,
    dataScopes: ALL,
    fieldMasks,
  });
  const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id, branchIds });
  return actorOf(user.id);
}

describe("the audit of one lead (A-081, A-082)", () => {
  it("scores on-time steps and fields: a late step lowers the score (AC-07)", async () => {
    await createTestUser("CONSULTING");
    const prompt = await lead("Đúng hạn", "onTime");
    const slow = await lead("Trễ hạn", "late");
    const viewer = await manager();

    const good = await leadAudit(viewer, prompt.id);
    const bad = await leadAudit(viewer, slow.id);

    // The step, plus the phone, pass; the need group is missing: 2 of 3.
    expect(good).toMatchObject({ onTime: 1, late: 0, skipped: 0, due: 1, compliance: 100, score: 67 });
    expect(bad).toMatchObject({ onTime: 0, late: 1, due: 1, compliance: 0, score: 33 });
    expect(good.steps.find((step) => step.key === "tu-van")).toMatchObject({ outcome: "ON_TIME" });
    expect(bad.steps.find((step) => step.key === "tu-van")).toMatchObject({ outcome: "LATE" });
    expect(good.criteria).toEqual([
      { key: "needGroup", weight: 1, active: true, applies: true, passed: false },
      { key: "phone", weight: 1, active: true, applies: true, passed: true },
      { key: "refuseReason", weight: 1, active: true, applies: false, passed: null },
    ]);
  });

  it("counts an open step past its deadline as late, and one still ahead for nothing", async () => {
    await createTestUser("CONSULTING");
    const overdue = await lead("Quá hạn", "openLate");
    const ahead = await lead("Chưa tới hạn", "openAhead");
    const viewer = await manager();

    expect(await leadAudit(viewer, overdue.id)).toMatchObject({ late: 1, due: 1, compliance: 0 });
    expect(await leadAudit(viewer, ahead.id)).toMatchObject({ late: 0, due: 0, compliance: null });
    // Waiting steps are listed too, with no outcome.
    expect((await leadAudit(viewer, ahead.id)).steps.every((step) => step.outcome === null)).toBe(true);
  });

  it("calls a step skipped when the person was shown before it was done", async () => {
    await createTestUser("CONSULTING");
    const shown = await lead("Đã Show", "openLate");
    await prisma.customer.update({
      where: { id: shown.id },
      data: { stage: "CUSTOMER", leadStatus: "SHOWED", customerCode: `KH${Math.floor(Math.random() * 1e9)}` },
    });

    const audit = await leadAudit(await manager(), shown.id);

    expect(audit).toMatchObject({ onTime: 0, late: 0, skipped: 1, due: 1 });
    expect(audit.steps.find((step) => step.key === "tu-van")).toMatchObject({ outcome: "SKIPPED" });
  });

  it("flags a refused lead that has no reason, and only a refused one", async () => {
    await createTestUser("CONSULTING");
    const refused = await lead("Từ chối thiếu lý do", "onTime");
    await prisma.customer.update({ where: { id: refused.id }, data: { leadStatus: "REFUSED", refuseReasonId: null } });
    const withReason = await lead("Từ chối có lý do", "onTime");
    await prisma.customer.update({
      where: { id: withReason.id },
      data: { leadStatus: "REFUSED", refuseReasonId: await optionId("leadRefuseReasons", "Khác") },
    });
    const viewer = await manager();

    const missing = await leadAudit(viewer, refused.id);
    const given = await leadAudit(viewer, withReason.id);

    expect(missing.criteria.find((c) => c.key === "refuseReason")).toMatchObject({ applies: true, passed: false });
    expect(given.criteria.find((c) => c.key === "refuseReason")).toMatchObject({ applies: true, passed: true });
    expect(missing.score).toBeLessThan(given.score!);
    const flagged = await leadsToCheck(viewer, {});
    expect(flagged.items.find((row) => row.id === refused.id)?.failed).toContain("refuseReason");
  });

  it("changes at once when admin switches a criterion off or weighs it", async () => {
    await createTestUser("CONSULTING");
    const created = await lead("Đổi tiêu chí", "onTime");
    const viewer = await manager();
    const { actor: admin } = await createTestUser("ADMIN");
    const criteria = (needGroup: { active: boolean; weight: number }) => ({
      criteria: [
        { key: "needGroup", ...needGroup },
        { key: "phone", active: true, weight: 1 },
        { key: "refuseReason", active: true, weight: 1 },
      ],
    });

    expect((await leadAudit(viewer, created.id)).score).toBe(67);
    await updateCriteria(admin, criteria({ active: false, weight: 1 }));
    expect((await leadAudit(viewer, created.id)).score).toBe(100);
    await updateCriteria(admin, criteria({ active: true, weight: 3 }));
    // The step and the phone pass (weight 2) of 5.
    expect((await leadAudit(viewer, created.id)).score).toBe(40);
  });

  it("is not found for an unknown id, a bad id, or a lead of another branch", async () => {
    const branch = await createTestBranch();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const elsewhere = await newLead(admin, "Chi nhánh khác", { branchId: branch.id });
    const viewer = await manager();

    for (const id of [randomUUID(), "not-a-uuid", elsewhere.id]) {
      await expect(leadAudit(viewer, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("the consultants' figures (A-082)", () => {
  it("add up each consultant's steps and fields, with the team's, and not an average of scores", async () => {
    const { actor: anh } = await createTestUser("CONSULTING", { name: "An" });
    const { actor: binh } = await createTestUser("CONSULTING", { name: "Bình" });
    await inRoundRobinOrder(anh.id, binh.id);
    const first = await lead("An một", "onTime");
    const second = await lead("Bình một", "late");
    const third = await lead("An hai", "late");
    const fourth = await lead("Bình hai", "late");
    const owners = new Map([
      [first.id, anh.id],
      [second.id, binh.id],
      [third.id, anh.id],
      [fourth.id, binh.id],
    ]);
    for (const [id, picUserId] of owners) await prisma.customer.update({ where: { id }, data: { picUserId } });

    const table = await consultantAudit(await manager(), {});

    expect(table.items.map((row) => row.consultant?.name)).toEqual(["An", "Bình"]);
    expect(table.items[0]).toMatchObject({ leads: 2, onTime: 1, late: 1, due: 2, compliance: 50, toCheck: 2 });
    expect(table.items[1]).toMatchObject({ leads: 2, onTime: 0, late: 2, due: 2, compliance: 0, toCheck: 2 });
    // Steps and phones: An passed 1 + 2 of 6, Bình 0 + 2 of 6; the team 5 of 12 (not the average of 33 and 17).
    expect(table.items.map((row) => row.score)).toEqual([50, 33]);
    expect(table.team).toMatchObject({ leads: 4, due: 4, onTime: 1, compliance: 25, score: 42 });
  });

  it("lists leads nobody is in charge of last, and keeps counting a person once shown", async () => {
    await createTestUser("CONSULTING", { name: "An" });
    const shown = await lead("Đã Show", "late");
    const orphan = await lead("Không ai phụ trách", "late");
    await prisma.customer.update({
      where: { id: shown.id },
      data: { stage: "CUSTOMER", leadStatus: "SHOWED", customerCode: `KH${Math.floor(Math.random() * 1e9)}` },
    });
    await prisma.customer.update({ where: { id: orphan.id }, data: { picUserId: null } });

    const table = await consultantAudit(await manager(), {});

    expect(table.items.map((row) => row.consultant?.name ?? null)).toEqual(["An", null]);
    // The shown person still counts in An's figures, but is no longer one to check.
    expect(table.items[0]).toMatchObject({ leads: 1, late: 1, toCheck: 0 });
    expect(table.items[1]).toMatchObject({ leads: 1, toCheck: 1 });
  });

  it("narrows to leads created in a period, in gym days", async () => {
    await createTestUser("CONSULTING");
    const old = await lead("Cũ", "late");
    await lead("Mới", "late");
    // 17:30 UTC on 30 September is 00:30 on 1 October in the gym.
    await prisma.customer.update({ where: { id: old.id }, data: { createdAt: new Date("2026-09-30T17:30:00Z") } });
    const viewer = await manager();

    const october = await consultantAudit(viewer, { from: "01/10/2026" });
    const september = await consultantAudit(viewer, { to: "30/09/2026" });
    const day = await consultantAudit(viewer, { from: "01/10/2026", to: "01/10/2026" });

    expect(october.team.leads).toBe(2);
    expect(september.team.leads).toBe(0);
    expect(day.team.leads).toBe(1);
    await expect(consultantAudit(viewer, { from: "31/02/2026" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("leads to check (A-085)", () => {
  it("lists the leads still in the journey with a problem, most urgent first, and pages them", async () => {
    await createTestUser("CONSULTING");
    const fine = await lead("Ổn", "onTime", { needGroupId: await optionId("needGroups", "Khác"), needGroupNote: "x" });
    const lateOnce = await lead("Trễ một lần", "late");
    const open = await lead("Mở quá hạn", "openLate");
    const viewer = await manager();

    const page = await leadsToCheck(viewer, {});

    // The fine lead (steps on time, every field there) is not listed; the others carry their failed criterion.
    expect(page.items.map((row) => row.id)).not.toContain(fine.id);
    expect(page.items.map((row) => row.id).sort()).toEqual([lateOnce.id, open.id].sort());
    expect(page.items.every((row) => row.failed.includes("needGroup"))).toBe(true);
    expect(page.total).toBe(2);
    const small = await leadsToCheck(viewer, { pageSize: "1", page: "2" });
    expect(small).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(small.items).toHaveLength(1);
  });

  it("puts the lead with more late steps and heavier failed criteria first", async () => {
    await createTestUser("CONSULTING");
    const heavy = await lead("Nặng", "late");
    const light = await lead("Nhẹ", "onTime");
    const { actor: admin } = await createTestUser("ADMIN");
    await updateCriteria(admin, {
      criteria: [
        { key: "needGroup", active: true, weight: 5 },
        { key: "phone", active: true, weight: 1 },
        { key: "refuseReason", active: true, weight: 1 },
      ],
    });

    const page = await leadsToCheck(await manager(), {});

    // Late (1) plus the need group (5) is 6; the light lead only fails the need group: 5.
    expect(page.items.map((row) => row.id)).toEqual([heavy.id, light.id]);
  });

  it("narrows to one consultant and to a period", async () => {
    const { actor: anh } = await createTestUser("CONSULTING", { name: "An" });
    const { actor: binh } = await createTestUser("CONSULTING", { name: "Bình" });
    await inRoundRobinOrder(anh.id, binh.id);
    const first = await lead("Của An", "late");
    const second = await lead("Của Bình", "late");
    await prisma.customer.update({ where: { id: first.id }, data: { picUserId: anh.id } });
    await prisma.customer.update({ where: { id: second.id }, data: { picUserId: binh.id } });
    await prisma.customer.update({ where: { id: second.id }, data: { createdAt: new Date("2026-01-05T05:00:00Z") } });
    const viewer = await manager();

    expect((await leadsToCheck(viewer, { consultantId: anh.id })).items.map((r) => r.id)).toEqual([first.id]);
    expect((await leadsToCheck(viewer, { to: "31/01/2026" })).items.map((r) => r.id)).toEqual([second.id]);
    await expect(leadsToCheck(viewer, { consultantId: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("who sees the audit (A-084, D-017)", () => {
  it("is for managers: Admin and Fitness Manager only, by default", async () => {
    const holders = (
      await prisma.rolePermission.findMany({ where: { permission: "lead.audit" }, include: { role: true } })
    )
      .map((holder) => holder.role.code)
      .sort();

    expect(holders).toEqual(["ADMIN", "FITNESS_MANAGER"]);
    for (const role of ["CONSULTING", "RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role);
      await expect(consultantAudit(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(leadsToCheck(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(leadAudit(actor, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listCriteria(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("does not show a user who cannot see phones the phone criterion or its flags", async () => {
    await createTestUser("CONSULTING");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const noPhone = await newLead(reception, "Không số");
    await prisma.customer.update({ where: { id: noPhone.id }, data: { phone: null } });
    const full = await manager();
    const masked = await userWith(["lead.view", "lead.audit"], ["customer.phone"]);

    const seenFull = await leadAudit(full, noPhone.id);
    const seenMasked = await leadAudit(masked, noPhone.id);

    expect(seenFull.criteria.map((c) => c.key)).toContain("phone");
    expect(seenMasked.criteria.map((c) => c.key)).not.toContain("phone");
    expect((await leadsToCheck(full, {})).items[0].failed).toContain("phone");
    expect((await leadsToCheck(masked, {})).items[0].failed).not.toContain("phone");
  });

  it("stays inside the user's branches", async () => {
    const branch = await createTestBranch();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    await createTestUser("CONSULTING");
    await newLead(admin, "Chi nhánh khác", { branchId: branch.id });
    await lead("Chi nhánh chính", "late");

    const own = await consultantAudit(await manager(), {});
    const everything = await consultantAudit(admin, {});

    expect(own.team.leads).toBe(1);
    expect(everything.team.leads).toBe(2);
  });
});

describe("the criteria (A-083)", () => {
  it("are seeded on with weight 1, and only admin changes them, audited", async () => {
    const viewer = await manager();
    const { actor: admin } = await createTestUser("ADMIN");
    const criteria = (weight: number) => ({
      criteria: [
        { key: "needGroup", active: true, weight },
        { key: "phone", active: true, weight: 1 },
        { key: "refuseReason", active: false, weight: 1 },
      ],
    });

    expect(await listCriteria(viewer)).toEqual([
      { key: "needGroup", active: true, weight: 1 },
      { key: "phone", active: true, weight: 1 },
      { key: "refuseReason", active: true, weight: 1 },
    ]);
    await expect(updateCriteria(await userWith(["lead.audit"]), criteria(2))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const saved = await updateCriteria(admin, criteria(4));

    expect(saved).toEqual([
      { key: "needGroup", active: true, weight: 4 },
      { key: "phone", active: true, weight: 1 },
      { key: "refuseReason", active: false, weight: 1 },
    ]);
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "audit_criterion" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => [event.before, event.after])).toContainEqual([{ weight: 1 }, { weight: 4 }]);
    expect(events.map((event) => event.metadata)).toContainEqual({ key: "refuseReason" });
  });

  it("refuse a weight outside 1 to 10, a missing, repeated, or unknown criterion", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const base = [
      { key: "needGroup", active: true, weight: 1 },
      { key: "phone", active: true, weight: 1 },
      { key: "refuseReason", active: true, weight: 1 },
    ];

    await expect(
      updateCriteria(admin, { criteria: [{ ...base[0], weight: 0 }, base[1], base[2]] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      updateCriteria(admin, { criteria: [{ ...base[0], weight: 11 }, base[1], base[2]] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(updateCriteria(admin, { criteria: [base[0], base[1]] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(updateCriteria(admin, { criteria: [base[0], base[0], base[1]] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      updateCriteria(admin, { criteria: [{ key: "colour", active: true, weight: 1 }, base[1], base[2]] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await prisma.auditCriterion.findMany()).every((row) => row.weight === 1 && row.active)).toBe(true);
  });
});
