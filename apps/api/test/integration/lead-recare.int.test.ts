import { afterEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import type { LeadChecklist } from "@flow/shared/leads";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { createLead, getLead } from "../../src/modules/leads/lead.service.js";
import { assignLead, changeLeadStatus } from "../../src/modules/leads/lead-journey.service.js";
import { completeLeadStep, leadChecklist, todaySteps } from "../../src/modules/leads/checklist.service.js";
import { recareList } from "../../src/modules/leads/lead-recare.service.js";
import { resetDatabase } from "../support/database.js";
import {
  createTestBranch,
  createTestUser,
  DEFAULT_BRANCH_ID,
  inRoundRobinOrder,
  optionId,
} from "../support/factories.js";
import { gymDay, intoRecare, newLead, refuseReason } from "../support/leads.js";

// Re-care list and the re-care step (brief §4.1 step 10; FR-LEAD-007; BR-204; A-062; AC-07).

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const step = (checklist: LeadChecklist, key: string) => checklist.items.find((item) => item.key === key)!;
const ids = (page: { items: { id: string }[] }) => page.items.map((row) => row.id);

/** One consultant with leads in every kind of state, made by reception. */
async function scenario() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: consultant } = await createTestUser("CONSULTING");
  const lead = (name: string) => newLead(reception, name);
  const refused = await lead("Từ chối sau");
  const overdue = await lead("Không phản hồi quá hạn");
  const noShow = await lead("Không đến");
  const undated = await lead("Chưa có ngày");
  const consulting = await lead("Đang tư vấn");
  const booked = await lead("Đã hẹn");
  await intoRecare(consultant, refused.id, "REFUSED", gymDay(5));
  await intoRecare(consultant, overdue.id, "NO_RESPONSE", gymDay(-2));
  await intoRecare(consultant, noShow.id, "NO_SHOW", gymDay(1));
  await intoRecare(consultant, undated.id, "NO_RESPONSE", null);
  await changeLeadStatus(consultant, booked.id, {
    status: "BOOKED",
    appointmentDate: "20/10/2030",
    appointmentTime: "18:30",
  });
  return { reception, manager, consultant, refused, overdue, noShow, undated, consulting, booked };
}

describe("the re-care list (FR-LEAD-007, BR-204)", () => {
  it("holds only leads in No response, Refused, or No show, by contact-again day, nulls last", async () => {
    const s = await scenario();

    const page = await recareList(s.consultant, {});

    expect(ids(page)).toEqual([s.overdue.id, s.noShow.id, s.refused.id, s.undated.id]);
    expect(page.total).toBe(4);
    expect(page.items.map((row) => row.status)).toEqual(["NO_RESPONSE", "NO_SHOW", "REFUSED", "NO_RESPONSE"]);
    expect(page.items.map((row) => row.overdue)).toEqual([true, false, false, false]);
    expect(page.items.map((row) => row.contactAgainOn)).toEqual([gymDay(-2), gymDay(1), gymDay(5), null]);
    expect(page.items[0]).toMatchObject({
      leadCode: s.overdue.leadCode,
      fullName: "Không phản hồi quá hạn",
      pic: { id: s.consultant.id },
      branch: { id: DEFAULT_BRANCH_ID },
    });
    expect(page.items[2].refuseReason).not.toBeNull();
    expect(page.overdueTotal).toBe(1);
  });

  it("breaks a tie on the contact-again day by when the lead entered its status", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const first = await newLead(reception, "Vào trước");
    const second = await newLead(reception, "Vào sau");
    await intoRecare(consultant, second.id, "NO_RESPONSE", gymDay(3));
    await intoRecare(consultant, first.id, "NO_RESPONSE", gymDay(3));
    await prisma.customer.update({ where: { id: first.id }, data: { leadStatusChangedAt: new Date("2026-01-01") } });
    await prisma.customer.update({ where: { id: second.id }, data: { leadStatusChangedAt: new Date("2026-01-02") } });

    expect(ids(await recareList(consultant, {}))).toEqual([first.id, second.id]);
  });

  it("filters by status, by overdue, and by the person in charge; overdueTotal counts the matches", async () => {
    const s = await scenario();

    expect(ids(await recareList(s.consultant, { status: "REFUSED" }))).toEqual([s.refused.id]);
    expect(ids(await recareList(s.consultant, { status: "NO_RESPONSE" }))).toEqual([s.overdue.id, s.undated.id]);
    const overdue = await recareList(s.consultant, { overdue: "true" });
    expect(ids(overdue)).toEqual([s.overdue.id]);
    expect(overdue.total).toBe(1);
    // overdue=false is no filter.
    expect(await recareList(s.consultant, { overdue: "false" })).toMatchObject({ total: 4 });
    // Overdue among the matches of the other filters.
    expect((await recareList(s.consultant, { status: "REFUSED" })).overdueTotal).toBe(0);
    expect((await recareList(s.consultant, { status: "NO_RESPONSE" })).overdueTotal).toBe(1);

    const { actor: other } = await createTestUser("CONSULTING");
    await assignLead(s.manager, s.refused.id, { userId: other.id });
    expect(ids(await recareList(s.manager, { scope: "all", picUserId: other.id }))).toEqual([s.refused.id]);
    expect(await recareList(s.manager, { scope: "all", picUserId: s.manager.id })).toMatchObject({ total: 0 });
  });

  it("is the lead's overdue day compared with the gym's today, not later: today itself is not overdue", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const today = await newLead(reception, "Hôm nay");
    const yesterday = await newLead(reception, "Hôm qua");
    await intoRecare(consultant, today.id, "NO_RESPONSE", gymDay(0));
    await intoRecare(consultant, yesterday.id, "NO_RESPONSE", gymDay(-1));

    const page = await recareList(consultant, {});

    expect(page.items.map((row) => [row.id, row.overdue])).toEqual([
      [yesterday.id, true],
      [today.id, false],
    ]);
  });

  it("pages the result with its total", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    for (const [index, name] of ["A", "B", "C"].entries()) {
      const lead = await newLead(reception, name);
      await intoRecare(consultant, lead.id, "NO_RESPONSE", gymDay(index));
    }

    const second = await recareList(consultant, { pageSize: "2", page: "2" });

    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.items.map((row) => row.fullName)).toEqual(["C"]);
  });

  it("scope mine is the leads in my charge; all is every lead I may see (T-061)", async () => {
    const s = await scenario();
    const { actor: other } = await createTestUser("CONSULTING");
    await assignLead(s.manager, s.refused.id, { userId: other.id });

    // A manager is in charge of none.
    expect(await recareList(s.manager, {})).toMatchObject({ total: 0 });
    expect(await recareList(s.manager, { scope: "mine" })).toMatchObject({ total: 0 });
    expect((await recareList(s.manager, { scope: "all" })).total).toBe(4);
    // A consultant sees their own leads under both scopes: their data scope is own.
    expect(ids(await recareList(s.consultant, { scope: "all" }))).toEqual(ids(await recareList(s.consultant, {})));
    expect(ids(await recareList(s.consultant, { scope: "all" }))).not.toContain(s.refused.id);
    expect(ids(await recareList(other, { scope: "all" }))).toEqual([s.refused.id]);
  });

  it("stays inside the user's branches", async () => {
    const s = await scenario();
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const elsewhere = await createTestBranch();
    const { actor: remote } = await createTestUser("CONSULTING", { branchIds: [elsewhere.id] });
    const far = await createLead(admin, { fullName: "Chi nhánh khác", channelId: WHATSAPP, branchId: elsewhere.id });
    await intoRecare(remote, far.id, "NO_RESPONSE", gymDay(-9));

    expect(ids(await recareList(s.manager, { scope: "all" }))).not.toContain(far.id);
    expect(ids(await recareList(remote, {}))).toEqual([far.id]);
    const all = await recareList(admin, { scope: "all" });
    expect(ids(all)).toContain(far.id);
    expect(all.total).toBe(5);
  });

  it("hides the phone from a role with it masked (D-017)", async () => {
    const s = await scenario();
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: "Xem lead, ẩn SĐT",
      permissions: ["lead.view"],
      dataScopes: {
        leads: "ALL",
        customers: "ALL",
        contracts: "ALL",
        schedule: "ALL",
        vouchers: "ALL",
        staff: "ALL",
        tasks: "OWN",
      },
      fieldMasks: ["customer.phone"],
    });
    const { actor: viewer } = await createTestUser("RECEPTIONIST", { roleId: role.id });

    const page = await recareList(viewer, { scope: "all" });

    expect(page.total).toBe(4);
    expect(page.items.every((row) => row.phone === null && row.maskedFields.includes("phone"))).toBe(true);
    const own = await recareList(s.consultant, {});
    expect(own.items[0].phone).toMatch(/^09\d{8}$/);
    expect(JSON.stringify(page)).not.toContain(own.items[0].phone as string);
  });

  it("needs lead.view, and refuses bad filters with field errors", async () => {
    const { actor: pt } = await createTestUser("PT");
    const { actor: consultant } = await createTestUser("CONSULTING");

    await expect(recareList(pt, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recareList(consultant, { status: "CONSULTING" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { status: ["invalidChoice"] },
    });
    await expect(recareList(consultant, { picUserId: "x" })).rejects.toMatchObject({
      fieldErrors: { picUserId: ["invalidChoice"] },
    });
    await expect(recareList(consultant, { scope: "everyone" })).rejects.toMatchObject({
      fieldErrors: { scope: ["invalidChoice"] },
    });
  });
});

describe("entering re-care (BR-203, BR-204)", () => {
  it("tells the consultant and the managers, not the one who did it, and lists the lead under its consultant", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(reception, "Im lặng");

    await changeLeadStatus(reception, lead.id, { status: "NO_RESPONSE" });

    const kinds = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId, kind: "leadRecare" } })).length;
    expect(await kinds(consultant.id)).toBe(1);
    expect(await kinds(manager.id)).toBe(1);
    expect(await kinds(reception.id)).toBe(0);
    expect(ids(await recareList(consultant, {}))).toEqual([lead.id]);
  });
});

describe("the re-care step results (brief §4.1 step 10, A-062)", () => {
  /** A lead in re-care: No response, with the re-care step open. */
  async function inRecare() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(reception, "Tái chăm sóc");
    await changeLeadStatus(consultant, lead.id, { status: "NO_RESPONSE" });
    return { reception, consultant, lead };
  }

  it("offers 'Đặt lịch' and 'Từ chối' with their effects", async () => {
    const { consultant, lead } = await inRecare();

    const recare = step(await leadChecklist(consultant, lead.id), "tai-cham-soc");

    expect(recare.state).toBe("OPEN");
    expect(recare.results.map((result) => [result.labelVi, result.effect])).toEqual([
      ["Đặt lịch", "BOOK"],
      ["Từ chối", "REFUSE"],
    ]);
  });

  it("'Đặt lịch' asks for the appointment, books the lead again, and the pre-visit steps return", async () => {
    const { consultant, lead } = await inRecare();
    const recare = step(await leadChecklist(consultant, lead.id), "tai-cham-soc");

    await expect(completeLeadStep(consultant, lead.id, recare.id, { resultIndex: 0 })).rejects.toMatchObject({
      fieldErrors: { book: ["required"] },
    });
    await expect(
      completeLeadStep(consultant, lead.id, recare.id, {
        resultIndex: 0,
        book: { appointmentDate: "01/01/2020", appointmentTime: "10:00" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getLead(consultant, lead.id)).status).toBe("NO_RESPONSE");

    const done = await completeLeadStep(consultant, lead.id, recare.id, {
      resultIndex: 0,
      book: { appointmentDate: "20/10/2030", appointmentTime: "18:30" },
      note: "Khách hẹn lại",
    });

    expect(step(done, "tai-cham-soc")).toMatchObject({ state: "DONE", result: { labelVi: "Đặt lịch" } });
    const booked = await getLead(consultant, lead.id);
    expect(booked).toMatchObject({ status: "BOOKED", contactAgainOn: null, refuseReason: null });
    expect(booked.appointmentAt).toEqual(new Date("2030-10-20T11:30:00.000Z"));
    // The same code as the status change: one history entry to Booked.
    expect(
      await prisma.leadStatusChange.count({
        where: { customerId: lead.id, fromStatus: "NO_RESPONSE", toStatus: "BOOKED" },
      }),
    ).toBe(1);
    // The pre-visit steps are open again, due before the appointment.
    const reminder = step(done, "nhac-truoc-hen-1");
    expect(reminder).toMatchObject({ state: "OPEN" });
    expect(reminder.dueAt).toEqual(new Date("2030-10-20T08:30:00.000Z"));
    // And they reach "Việc hôm nay" when due.
    await prisma.leadStep.updateMany({
      where: { customerId: lead.id, template: { key: "nhac-truoc-hen-1" }, doneAt: null },
      data: { dueAt: new Date() },
    });
    const today = await todaySteps(consultant, {});
    expect(today.items.map((item) => [item.lead.id, item.step.key])).toContainEqual([lead.id, "nhac-truoc-hen-1"]);
    // The lead left the re-care list.
    expect(await recareList(consultant, {})).toMatchObject({ total: 0 });
  });

  it("'Từ chối' asks for the reason and sets the next contact-again day (today + recareDays)", async () => {
    const { consultant, lead } = await inRecare();
    const recare = step(await leadChecklist(consultant, lead.id), "tai-cham-soc");
    const reason = await refuseReason();

    await expect(completeLeadStep(consultant, lead.id, recare.id, { resultIndex: 1 })).rejects.toMatchObject({
      fieldErrors: { refuse: ["required"] },
    });
    await expect(
      completeLeadStep(consultant, lead.id, recare.id, {
        resultIndex: 1,
        refuse: { refuseReasonId: await optionId("leadRefuseReasons", "Khác"), refuseReasonNote: "" },
      }),
    ).rejects.toMatchObject({ fieldErrors: { "refuse.refuseReasonNote": ["otherNeedsNote"] } });
    await expect(
      completeLeadStep(consultant, lead.id, recare.id, {
        resultIndex: 1,
        refuse: { refuseReasonId: WHATSAPP, refuseReasonNote: "" },
      }),
    ).rejects.toMatchObject({ fieldErrors: { "refuse.refuseReasonId": ["invalidChoice"] } });

    const done = await completeLeadStep(consultant, lead.id, recare.id, {
      resultIndex: 1,
      refuse: { refuseReasonId: reason, refuseReasonNote: "" },
    });

    expect(step(done, "tai-cham-soc")).toMatchObject({ result: { labelVi: "Từ chối" } });
    expect(await getLead(consultant, lead.id)).toMatchObject({
      status: "REFUSED",
      refuseReason: { id: reason },
      contactAgainOn: gymDay(15),
    });
  });

  it("sets the day again after every refusal or no response, from the day of that change (A-062)", async () => {
    const { consultant, lead } = await inRecare();
    const { actor: admin } = await createTestUser("ADMIN");
    expect((await getLead(consultant, lead.id)).contactAgainOn).toEqual(gymDay(15));
    // Months later, nothing moved: a second change counts again from today.
    await prisma.customer.update({ where: { id: lead.id }, data: { contactAgainOn: gymDay(-40) } });
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, recareDays: "9" });

    const refused = await changeLeadStatus(consultant, lead.id, {
      status: "REFUSED",
      refuseReasonId: await refuseReason(),
    });
    expect(refused.contactAgainOn).toEqual(gymDay(9));

    await changeLeadStatus(consultant, lead.id, { status: "CONSULTING" });
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, recareDays: "4" });
    const again = await changeLeadStatus(consultant, lead.id, {
      status: "REFUSED",
      refuseReasonId: await refuseReason(),
    });
    expect(again.contactAgainOn).toEqual(gymDay(4));
  });

  it("is for those who may change the lead", async () => {
    const { lead, consultant } = await inRecare();
    const recare = step(await leadChecklist(consultant, lead.id), "tai-cham-soc");
    const { actor: stranger } = await createTestUser("CONSULTING");
    const { actor: pt } = await createTestUser("PT");
    const input = { resultIndex: 0, book: { appointmentDate: "20/10/2030", appointmentTime: "18:30" } };

    await expect(completeLeadStep(stranger, lead.id, recare.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeLeadStep(pt, lead.id, recare.id, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getLead(consultant, lead.id)).status).toBe("NO_RESPONSE");
  });
});

describe("re-care and the person in charge (BR-203)", () => {
  it("does not reassign a lead that entered re-care", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const consultants = await Promise.all([1, 2].map(() => createTestUser("CONSULTING").then(({ actor }) => actor)));
    await inRoundRobinOrder(...consultants.map((c) => c.id));
    const lead = await newLead(reception, "Giữ người phụ trách");

    await changeLeadStatus(reception, lead.id, { status: "NO_RESPONSE" });

    expect((await getLead(reception, lead.id)).pic?.id).toBe(consultants[0].id);
  });
});
