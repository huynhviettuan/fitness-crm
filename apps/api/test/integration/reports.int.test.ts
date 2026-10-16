import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@gymcrm/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { consultingReport, leadAnalysis } from "../../src/modules/reports/report.service.js";
import { consultingReportExport, leadAnalysisExport } from "../../src/modules/reports/report.export.js";
import { resetDatabase } from "../support/database.js";
import { activeContract } from "../support/bookings.js";
import { exportToWorkbook } from "../support/export.js";
import {
  actorOf,
  createTestBranch,
  createTestOption,
  createTestUser,
  inRoundRobinOrder,
  optionId,
} from "../support/factories.js";
import { newLead } from "../support/leads.js";

// The consulting dashboard and the lead analysis (brief §9, D-041; A-089 to A-094; AC-08).

afterEach(resetDatabase);

const MINUTE = 60_000;
const T0 = new Date("2026-10-05T03:00:00Z");
const ALL = Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])) as Record<
  (typeof DATA_SCOPE_RESOURCES)[number],
  "ALL" | "OWN"
>;

type Reached = {
  /** Minutes after assignment that the first step was done; none: not consulted. */
  consultedAfter?: number;
  /** Status changes after the lead was created, in order. */
  changes?: ("BOOKED" | "NO_SHOW" | "REFUSED" | "NO_RESPONSE")[];
  showed?: boolean;
  contracted?: boolean;
  picUserId: string;
};

const reception = () => createTestUser("RECEPTIONIST").then(({ actor }) => actor);

/** A lead with the history a test needs, written the way the services leave it. */
async function lead(name: string, reached: Reached, extra: Record<string, unknown> = {}) {
  const created = await newLead(await reception(), name, extra);
  await prisma.customer.update({
    where: { id: created.id },
    data: { picUserId: reached.picUserId, createdAt: T0 },
  });
  await prisma.leadAssignment.updateMany({ where: { customerId: created.id }, data: { assignedAt: T0 } });
  if (reached.consultedAfter !== undefined) {
    await prisma.leadStep.updateMany({
      where: { customerId: created.id, template: { key: "tu-van" } },
      data: {
        doneAt: new Date(T0.getTime() + reached.consultedAfter * MINUTE),
        dueAt: new Date(T0.getTime() + 60 * MINUTE),
        timing: "ON_TIME",
      },
    });
  }
  let at = T0.getTime() + 120 * MINUTE;
  for (const toStatus of reached.changes ?? []) {
    await prisma.leadStatusChange.create({
      data: { customerId: created.id, fromStatus: "CONSULTING", toStatus, changedAt: new Date((at += MINUTE)) },
    });
  }
  if (reached.showed || reached.contracted) {
    await prisma.customer.update({
      where: { id: created.id },
      data: { stage: "CUSTOMER", leadStatus: "SHOWED", customerCode: `KH${Math.floor(Math.random() * 1e9)}` },
    });
    await prisma.leadStatusChange.create({
      data: { customerId: created.id, fromStatus: "BOOKED", toStatus: "SHOWED", changedAt: new Date((at += MINUTE)) },
    });
  }
  if (reached.contracted) await activeContract((await createTestUser("FITNESS_MANAGER")).actor, created.id);
  return created;
}

/** An (3 leads) and Bình (2 leads), with every kind of history between them. */
async function dataset() {
  const { actor: an } = await createTestUser("CONSULTING", { name: "An" });
  const { actor: binh } = await createTestUser("CONSULTING", { name: "Bình" });
  await inRoundRobinOrder(an.id, binh.id);
  await lead("An một", { picUserId: an.id, consultedAfter: 30, changes: ["BOOKED"], showed: true, contracted: true });
  await lead("An hai", { picUserId: an.id, consultedAfter: 90, changes: ["BOOKED", "NO_SHOW", "BOOKED"] });
  await lead("An ba", { picUserId: an.id });
  await lead("Bình một", { picUserId: binh.id, consultedAfter: 10, changes: ["REFUSED"] });
  await lead("Bình hai", { picUserId: binh.id });
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  return { an, binh, manager };
}

describe("the consulting dashboard (A-089 to A-091)", () => {
  it("counts the funnel, the rates, the first response, and re-care of each consultant and of the team", async () => {
    const { an, binh, manager } = await dataset();

    const report = await consultingReport(manager, {});

    expect(report.items.map((row) => row.consultant?.name)).toEqual(["An", "Bình"]);
    const [anRow, binhRow] = report.items;
    expect(anRow).toMatchObject({
      consultant: { id: an.id },
      leads: 3,
      consulted: 2,
      booked: 2,
      showed: 1,
      contracted: 1,
      bookingRate: 67,
      showRate: 50,
      // The median of 30 and 90 minutes.
      firstResponseMinutes: 60,
      recareEntered: 1,
      recareRebooked: 1,
      recareRate: 100,
    });
    expect(binhRow).toMatchObject({
      consultant: { id: binh.id },
      leads: 2,
      consulted: 1,
      booked: 0,
      showed: 0,
      contracted: 0,
      bookingRate: 0,
      showRate: null,
      firstResponseMinutes: 10,
      recareEntered: 1,
      recareRebooked: 0,
      recareRate: 0,
    });
    expect(report.team).toMatchObject({
      leads: 5,
      consulted: 3,
      booked: 2,
      showed: 1,
      contracted: 1,
      bookingRate: 40,
      showRate: 50,
      firstResponseMinutes: 30,
      recareEntered: 2,
      recareRebooked: 1,
      recareRate: 50,
    });
  });

  it("has the audit's compliance and score for the cohort, and nothing where there is nothing to measure", async () => {
    const { manager } = await dataset();

    const { items, team } = await consultingReport(manager, {});

    // The consulting step was done on time for An's and Bình's consulted leads.
    expect(items[0].compliance).toBe(100);
    expect(typeof items[0].score).toBe("number");
    expect(team.compliance).toBe(100);
    expect(await consultingReport(manager, { from: "01/01/2020", to: "02/01/2020" })).toMatchObject({
      items: [],
      team: { leads: 0, bookingRate: null, showRate: null, compliance: null, score: null, firstResponseMinutes: null },
    });
  });

  it("narrows to the leads created in a period, in gym days, to a consultant, and to a branch", async () => {
    const { an, manager } = await dataset();
    const branch = await createTestBranch();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    await newLead(admin, "Chi nhánh khác", { branchId: branch.id });

    expect((await consultingReport(manager, { from: "05/10/2026", to: "05/10/2026" })).team.leads).toBe(5);
    expect((await consultingReport(manager, { from: "06/10/2026" })).team.leads).toBe(0);
    expect((await consultingReport(manager, { to: "04/10/2026" })).team.leads).toBe(0);
    const staff = await consultingReport(manager, { staffId: an.id, from: "05/10/2026", to: "05/10/2026" });
    expect(staff.items.map((row) => row.consultant?.name)).toEqual(["An"]);
    expect(staff.team.leads).toBe(3);
    // Everything: the manager's own branch only; the admin's view adds the other branch.
    expect((await consultingReport(admin, { branchId: branch.id })).team.leads).toBe(1);
    expect((await consultingReport(manager, { branchId: branch.id })).team.leads).toBe(0);
  });

  it("puts leads nobody is in charge of last", async () => {
    const { manager } = await dataset();
    const orphan = await lead("Không ai", { picUserId: (await createTestUser("CONSULTING")).actor.id });
    await prisma.customer.update({ where: { id: orphan.id }, data: { picUserId: null } });

    const { items } = await consultingReport(manager, {});

    expect(items.at(-1)?.consultant).toBeNull();
    expect(items.at(-1)?.leads).toBe(1);
  });

  it("shows a consultant their own leads only, by their data scope, and refuses roles without the permission", async () => {
    const { an } = await dataset();

    const own = await consultingReport(an, {});

    expect(own.items.map((row) => row.consultant?.name)).toEqual(["An"]);
    expect(own.team.leads).toBe(3);
    for (const role of ["RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role);
      await expect(consultingReport(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("rejects a bad day, branch, or person", async () => {
    const { manager } = await dataset();

    for (const query of [{ from: "31/02/2026" }, { to: "nope" }, { branchId: "x" }, { staffId: "x" }]) {
      await expect(consultingReport(manager, query)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});

describe("the lead analysis (A-092)", () => {
  it("splits the cohort by channel, source, Organic or Paid, need, nationality, and refusal reason", async () => {
    const { an, manager } = await dataset();
    const whatsapp = await optionId("leadChannels", "WhatsApp");
    const zalo = await optionId("leadChannels", "Zalo");
    const web = await optionId("leadSources", "Website");
    const strength = await createTestOption("needGroups", "Tăng cơ");
    const price = await createTestOption("leadRefuseReasons", "Giá cao");
    await lead(
      "Có đủ hồ sơ",
      {
        picUserId: an.id,
        changes: ["BOOKED"],
        showed: true,
      },
      {
        channelId: zalo,
        sourceId: web,
        sourceType: "PAID",
        needGroupId: strength,
        countryCode: "US",
        nationalityGroup: "FOREIGN",
      },
    );
    const refused = await lead("Từ chối", { picUserId: an.id, changes: ["REFUSED"] });
    await prisma.customer.update({
      where: { id: refused.id },
      data: { leadStatus: "REFUSED", refuseReasonId: price },
    });

    const analysis = await leadAnalysis(manager, {});

    expect(analysis.total).toBe(7);
    const find = (dimension: string) => analysis.dimensions.find((d) => d.dimension === dimension)!.buckets;
    const channel = find("channel");
    expect(channel.find((b) => b.option?.id === zalo)).toMatchObject({
      leads: 1,
      booked: 1,
      showed: 1,
      bookingRate: 100,
      showRate: 100,
    });
    // The other six came in on WhatsApp, the default of the test leads.
    expect(channel.find((b) => b.option?.id === whatsapp)).toMatchObject({ leads: 6, booked: 2, showed: 1 });
    expect(find("source").find((b) => b.option?.id === web)).toMatchObject({ leads: 1 });
    expect(find("source").at(-1)).toMatchObject({ option: null, value: null, leads: 6 });
    expect(find("sourceType").map((b) => [b.value, b.leads])).toEqual([
      ["PAID", 1],
      [null, 6],
    ]);
    expect(find("needGroup").find((b) => b.option?.id === strength)).toMatchObject({ leads: 1 });
    expect(find("nationalityGroup").map((b) => [b.value, b.leads])).toEqual([
      ["FOREIGN", 1],
      [null, 6],
    ]);
    expect(find("country").map((b) => [b.value, b.leads])).toEqual([
      ["US", 1],
      [null, 6],
    ]);
    // Only people refused now, or with a reason, count by reason.
    expect(find("refuseReason").map((b) => [b.option?.labelVi ?? null, b.leads])).toEqual([["Giá cao", 1]]);
  });

  it("lists the notes written with Khác, grouped and most used first, only for that bucket", async () => {
    const { an, manager } = await dataset();
    const other = await optionId("leadChannels", "Khác");
    for (const note of ["Zalo OA", "zalo oa ", "Zalo OA", "Hội thảo", "Giới thiệu"]) {
      await lead(`Khác ${note}`, { picUserId: an.id }, { channelId: other, channelNote: note });
    }

    const analysis = await leadAnalysis(manager, {});

    const channel = analysis.dimensions.find((d) => d.dimension === "channel")!.buckets;
    const khac = channel.find((b) => b.option?.isOther)!;
    expect(khac.leads).toBe(5);
    expect(khac.notes).toEqual([
      { note: "Zalo OA", count: 3 },
      { note: "Giới thiệu", count: 1 },
      { note: "Hội thảo", count: 1 },
    ]);
    expect(channel.filter((b) => !b.option?.isOther).every((b) => b.notes.length === 0)).toBe(true);
  });

  it("narrows like the dashboard, and is for managers and Marketing, who see counts without personal data", async () => {
    const { an, manager } = await dataset();
    const { actor: marketing } = await createTestUser("MARKETING");
    const { actor: consulting } = await createTestUser("CONSULTING");

    expect((await leadAnalysis(manager, { staffId: an.id })).total).toBe(3);
    expect((await leadAnalysis(manager, { to: "04/10/2026" })).total).toBe(0);
    expect((await leadAnalysis(marketing, {})).total).toBe(5);
    await expect(leadAnalysis(consulting, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(leadAnalysis(await reception(), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(await leadAnalysis(marketing, {}))).not.toMatch(/"(phone|email|fullName|leadCode)"/);
  });
});

describe("the permissions (A-093)", () => {
  it("are held by Admin and Fitness Manager (all four), Consulting (the dashboard), and Marketing (the analysis)", async () => {
    const holders = async (permission: string) =>
      (await prisma.rolePermission.findMany({ where: { permission }, include: { role: true } }))
        .map((holder) => holder.role.code)
        .sort();

    expect(await holders("report.consulting")).toEqual(["ADMIN", "CONSULTING", "FITNESS_MANAGER"]);
    expect(await holders("report.consultingExport")).toEqual(["ADMIN", "FITNESS_MANAGER"]);
    expect(await holders("report.leadAnalysis")).toEqual(["ADMIN", "FITNESS_MANAGER", "MARKETING"]);
    expect(await holders("report.leadAnalysisExport")).toEqual(["ADMIN", "FITNESS_MANAGER", "MARKETING"]);
  });

  it("are separate: a role holding one report does not get the other", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: `Vai trò ${randomUUID().slice(0, 8)}`,
      permissions: ["report.consulting"],
      dataScopes: ALL,
      fieldMasks: [],
    });
    const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id });
    const actor = await actorOf(user.id);

    await expect(consultingReport(actor, {})).resolves.toBeDefined();
    await expect(leadAnalysis(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the Excel exports (A-093, A-078 to A-080)", () => {
  it("writes a row per consultant and the team last, with the same figures as the screen", async () => {
    const { manager } = await dataset();

    const { header, rows, sheet } = await exportToWorkbook(manager, consultingReportExport, {});

    expect(sheet.name).toBe("Dashboard tư vấn");
    expect(header.slice(0, 3)).toEqual(["Người tư vấn", "Lead nhận", "Đã tư vấn"]);
    expect(rows.map((row) => row[0])).toEqual(["An", "Bình", "Toàn đội"]);
    expect(rows[0].slice(1, 6)).toEqual([3, 2, 2, 1, 1]);
    expect(rows[2].slice(1, 6)).toEqual([5, 3, 2, 1, 1]);
  });

  it("writes a row per bucket of each dimension for the lead analysis", async () => {
    const { manager } = await dataset();

    const { rows, header } = await exportToWorkbook(manager, leadAnalysisExport, {});

    expect(header.slice(0, 2)).toEqual(["Chiều phân tích", "Giá trị"]);
    expect(rows.some((row) => row[0] === "Kênh liên hệ" && row[1] === "WhatsApp" && row[2] === 5)).toBe(true);
    expect(rows.some((row) => row[0] === "Organic / Paid" && row[1] === "Chưa có")).toBe(true);
  });

  it("needs the report's own export permission, and the report's permission too", async () => {
    await dataset();
    const { actor: consulting } = await createTestUser("CONSULTING");
    const { actor: marketing } = await createTestUser("MARKETING");

    await expect(exportToWorkbook(consulting, consultingReportExport, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportToWorkbook(marketing, consultingReportExport, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportToWorkbook(marketing, leadAnalysisExport, {})).resolves.toBeDefined();
    expect(await prisma.auditEvent.count({ where: { action: "export.downloaded" } })).toBe(1);
  });
});
