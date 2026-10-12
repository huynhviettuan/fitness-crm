import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { consultantAudit } from "../../src/modules/leads/lead-audit.service.js";
import { addManagerAudit, auditQueue, managerAudits } from "../../src/modules/leads/manager-audit.service.js";
import { resetDatabase } from "../support/database.js";
import {
  createTestBranch,
  createTestOption,
  createTestUser,
  inRoundRobinOrder,
  optionId,
} from "../support/factories.js";
import { newLead } from "../support/leads.js";

// The manager's audit of a lead (brief §4.1, FR-LEAD-011; A-086 to A-088).

afterEach(resetDatabase);

const manager = () => createTestUser("FITNESS_MANAGER").then(({ actor }) => actor);
const lead = async (name: string) => newLead((await createTestUser("RECEPTIONIST")).actor, name);

describe("grading a lead (A-086, A-087)", () => {
  it("keeps every grade, newest first, and the latest counts", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Được chấm");
    const viewer = await manager();
    const missing = await createTestOption("auditFailReasons", "Chưa hỏi mục tiêu");
    const price = await createTestOption("auditFailReasons", "Báo giá sai");

    const first = await addManagerAudit(viewer, target.id, {
      result: "FAIL",
      criterionIds: [missing, price],
      comment: "  Cần tư vấn lại.  ",
    });
    const second = await addManagerAudit(viewer, target.id, { result: "PASS" });

    expect(first).toMatchObject({ result: "FAIL", comment: "Cần tư vấn lại.", auditor: { id: viewer.id } });
    expect(first.criteria.map((criterion) => criterion.labelVi).sort()).toEqual(["Báo giá sai", "Chưa hỏi mục tiêu"]);
    expect(second).toMatchObject({ result: "PASS", comment: null, criteria: [] });
    const history = await managerAudits(viewer, target.id);
    expect(history.map((audit) => audit.id)).toEqual([second.id, first.id]);
    expect(await prisma.consultingAudit.count()).toBe(2);
  });

  it("lets the consultant see the result and refuses them the grading", async () => {
    const { actor: consultant } = await createTestUser("CONSULTING");
    const target = await lead("Của tư vấn");
    const criterion = await createTestOption("auditFailReasons", "Thiếu bước nhắc");
    const viewer = await manager();
    await addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [criterion], comment: "Nhắc muộn" });

    const seen = await managerAudits(consultant, target.id);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ result: "FAIL", comment: "Nhắc muộn" });
    await expect(addManagerAudit(consultant, target.id, { result: "PASS" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await prisma.consultingAudit.count()).toBe(1);
  });

  it("is not for someone who cannot see the lead", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const target = await lead("Không ai thấy");

    await expect(managerAudits(accountant, target.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addManagerAudit(accountant, target.id, { result: "PASS" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("is not found for an unknown id, a bad id, or a lead of another branch", async () => {
    const branch = await createTestBranch();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const elsewhere = await newLead(admin, "Chi nhánh khác", { branchId: branch.id });
    const viewer = await manager();

    for (const id of [randomUUID(), "not-a-uuid", elsewhere.id]) {
      await expect(addManagerAudit(viewer, id, { result: "PASS" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(managerAudits(viewer, elsewhere.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("can grade a customer who came in as a lead", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Đã Show");
    await prisma.customer.update({
      where: { id: target.id },
      data: { stage: "CUSTOMER", leadStatus: "SHOWED", customerCode: `KH${Math.floor(Math.random() * 1e9)}` },
    });

    const audit = await addManagerAudit(await manager(), target.id, { result: "PASS" });

    expect(audit.result).toBe("PASS");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "lead.audited" } });
    expect(event.entityType).toBe("customer");
  });

  it("records in the history that a grade was made, not the comment", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Có vết");
    const criterion = await createTestOption("auditFailReasons", "Sai kịch bản");
    const viewer = await manager();

    const audit = await addManagerAudit(viewer, target.id, {
      result: "FAIL",
      criterionIds: [criterion],
      comment: "Khách kể về chứng đau lưng",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: target.id, action: "lead.audited" } });
    expect(event).toMatchObject({ actorUserId: viewer.id, entityType: "lead" });
    expect(event.after).toEqual({ auditId: audit.id, result: "FAIL", criterionIds: [criterion], commented: true });
    expect(JSON.stringify(event)).not.toContain("đau lưng");
  });
});

describe("what a grade needs (A-087)", () => {
  it("needs a criterion for a Fail and none for a Pass, each at most once", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Quy tắc");
    const viewer = await manager();
    const criterion = await createTestOption("auditFailReasons", "Một tiêu chí");

    await expect(addManagerAudit(viewer, target.id, { result: "FAIL" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { criterionIds: ["required"] },
    });
    await expect(
      addManagerAudit(viewer, target.id, { result: "PASS", criterionIds: [criterion] }),
    ).rejects.toMatchObject({ fieldErrors: { criterionIds: ["noCriteriaOnPass"] } });
    await expect(
      addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [criterion, criterion] }),
    ).rejects.toMatchObject({ fieldErrors: { criterionIds: ["invalidChoice"] } });
    await expect(addManagerAudit(viewer, target.id, { result: "MAYBE" })).rejects.toMatchObject({
      fieldErrors: { result: ["invalidChoice"] },
    });
    expect(await prisma.consultingAudit.count()).toBe(0);
  });

  it("takes only active options of its own list", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Tiêu chí");
    const viewer = await manager();
    const inactive = await createTestOption("auditFailReasons", "Đã tắt", false);
    const elsewhere = await optionId("leadChannels", "Zalo");

    for (const id of [inactive, elsewhere, randomUUID()]) {
      await expect(addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [id] })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: { criterionIds: ["invalidChoice"] },
      });
    }
  });

  it('needs the comment with "Khác", and limits and cleans the comment', async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Khác");
    const viewer = await manager();
    const other = await optionId("auditFailReasons", "Khác");

    await expect(addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [other] })).rejects.toMatchObject({
      fieldErrors: { comment: ["otherNeedsNote"] },
    });
    await expect(
      addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [other], comment: "x".repeat(2001) }),
    ).rejects.toMatchObject({ fieldErrors: { comment: ["tooLong"] } });
    await expect(addManagerAudit(viewer, target.id, { result: "PASS", comment: "a\u0000b" })).rejects.toMatchObject({
      fieldErrors: { comment: ["invalidCharacters"] },
    });
    const done = await addManagerAudit(viewer, target.id, {
      result: "FAIL",
      criterionIds: [other],
      comment: "Lý do khác",
    });
    expect(done.criteria[0]).toMatchObject({ isOther: true });
  });
});

describe('the queue "Chưa audit" (A-088)', () => {
  it("lists the people nobody has audited, oldest first, and drops one once audited", async () => {
    await createTestUser("CONSULTING");
    const old = await lead("Cũ nhất");
    const middle = await lead("Giữa");
    const recent = await lead("Mới nhất");
    await prisma.customer.update({ where: { id: old.id }, data: { createdAt: new Date("2026-01-01T05:00:00Z") } });
    await prisma.customer.update({ where: { id: middle.id }, data: { createdAt: new Date("2026-02-01T05:00:00Z") } });
    const viewer = await manager();

    const before = await auditQueue(viewer, {});
    await addManagerAudit(viewer, middle.id, { result: "PASS" });
    const after = await auditQueue(viewer, {});

    expect(before.items.map((row) => row.id)).toEqual([old.id, middle.id, recent.id]);
    expect(before).toMatchObject({ total: 3, page: 1 });
    expect(after.items.map((row) => row.id)).toEqual([old.id, recent.id]);
  });

  it("leaves a person once graded, whatever the result", async () => {
    await createTestUser("CONSULTING");
    const target = await lead("Rớt");
    const criterion = await createTestOption("auditFailReasons", "Rớt tiêu chí");
    const viewer = await manager();

    await addManagerAudit(viewer, target.id, { result: "FAIL", criterionIds: [criterion] });

    expect((await auditQueue(viewer, {})).total).toBe(0);
  });

  it("narrows by consultant and period, pages, and counts per consultant", async () => {
    const { actor: anh } = await createTestUser("CONSULTING", { name: "An" });
    const { actor: binh } = await createTestUser("CONSULTING", { name: "Bình" });
    await inRoundRobinOrder(anh.id, binh.id);
    const first = await lead("Của An một");
    const second = await lead("Của An hai");
    const third = await lead("Của Bình");
    await prisma.customer.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { picUserId: anh.id } });
    await prisma.customer.update({ where: { id: third.id }, data: { picUserId: binh.id } });
    await prisma.customer.update({ where: { id: third.id }, data: { createdAt: new Date("2026-01-05T05:00:00Z") } });
    const viewer = await manager();
    await addManagerAudit(viewer, second.id, { result: "PASS" });

    expect((await auditQueue(viewer, { consultantId: anh.id })).items.map((row) => row.id)).toEqual([first.id]);
    expect((await auditQueue(viewer, { to: "31/01/2026" })).items.map((row) => row.id)).toEqual([third.id]);
    const paged = await auditQueue(viewer, { page: "2", pageSize: "1" });
    expect(paged).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(paged.items).toHaveLength(1);
    const table = await consultantAudit(viewer, {});
    expect(table.items.map((row) => [row.consultant?.name, row.unaudited])).toEqual([
      ["An", 1],
      ["Bình", 1],
    ]);
    await expect(auditQueue(viewer, { consultantId: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is for managers and stays inside their branches", async () => {
    const branch = await createTestBranch();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    await createTestUser("CONSULTING");
    await newLead(admin, "Chi nhánh khác", { branchId: branch.id });
    await lead("Chi nhánh chính");

    expect((await auditQueue(await manager(), {})).total).toBe(1);
    expect((await auditQueue(admin, {})).total).toBe(2);
    for (const role of ["CONSULTING", "RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role);
      await expect(auditQueue(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
