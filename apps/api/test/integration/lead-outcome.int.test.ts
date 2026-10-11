import { afterEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import type { LeadChecklist } from "@flow/shared/leads";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { createLead, getLead, listLeads } from "../../src/modules/leads/lead.service.js";
import { changeLeadStatus } from "../../src/modules/leads/lead-journey.service.js";
import { completeLeadStep, leadChecklist } from "../../src/modules/leads/checklist.service.js";
import { noShowLead, showLead } from "../../src/modules/leads/lead-outcome.service.js";
import { createCustomer, getCustomer } from "../../src/modules/customers/customer.service.js";
import { getTask } from "../../src/modules/tasks/task.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestOption, createTestUser, optionId, uniquePhone } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const PAIN_COACH = await optionId("painStatuses", "2.1 (Coach)");
const PHYSICAL = await optionId("assessmentTypes", "Physical Assessment");
const ID_NUMBER = "079201001234";

const show = (overrides: Record<string, unknown> = {}) => ({
  idDocumentType: "CCCD",
  idDocumentNumber: ID_NUMBER,
  birthDate: "15/03/1990",
  nationality: "Việt Nam",
  email: "an@example.com",
  phone: uniquePhone(),
  healthNote: "Đau lưng dưới",
  consent: true,
  ...overrides,
});
const step = (checklist: LeadChecklist, key: string) => checklist.items.find((item) => item.key === key)!;

/** A lead in a consultant's charge, booked for a visit far ahead. */
async function bookedLead() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: consultant } = await createTestUser("CONSULTING");
  const lead = await createLead(reception, {
    fullName: "Nguyễn Văn An",
    channelId: WHATSAPP,
    painStatusId: PAIN_COACH,
    assessmentTypeId: PHYSICAL,
  });
  await changeLeadStatus(consultant, lead.id, {
    status: "BOOKED",
    appointmentDate: "20/10/2030",
    appointmentTime: "18:30",
  });
  return { reception, consultant, lead };
}

describe("Show (D-019, BR-206)", () => {
  it("makes the lead a customer in the same record, with a customer code, and records the step and the history", async () => {
    const { reception, lead } = await bookedLead();

    const { customerId } = await showLead(reception, lead.id, show());

    expect(customerId).toBe(lead.id);
    const customer = await getCustomer(reception, lead.id);
    expect(customer).toMatchObject({
      customerCode: expect.stringMatching(/^KH\d+$/),
      email: "an@example.com",
      dateOfBirth: new Date(Date.UTC(1990, 2, 15)),
      nationality: "Việt Nam",
      idDocumentType: "CCCD",
      idDocumentNumber: ID_NUMBER,
      healthNote: "Đau lưng dưới",
      dataConsentAt: expect.any(Date),
    });
    expect((await listLeads(reception, {})).total).toBe(0);
    await expect(getLead(reception, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row).toMatchObject({
      stage: "CUSTOMER",
      leadStatus: "SHOWED",
      leadCode: lead.leadCode,
      dataConsentById: reception.id,
    });
    expect(
      await prisma.leadStatusChange.findFirst({ where: { customerId: lead.id, toStatus: "SHOWED" } }),
    ).toMatchObject({
      fromStatus: "BOOKED",
      changedById: reception.id,
    });
    const checklist = await leadChecklist(reception, lead.id).catch(() => null);
    expect(checklist).toBeNull();
    const showStep = await prisma.leadStep.findFirstOrThrow({
      where: { customerId: lead.id, template: { key: "show" } },
    });
    expect(showStep).toMatchObject({ resultIndex: 0, doneById: reception.id });
  });

  it("keeps the ID number and health note encrypted, and out of the history (D-042)", async () => {
    const { reception, lead } = await bookedLead();

    await showLead(reception, lead.id, show());

    const [row] = await prisma.$queryRaw<{ id_document_number: string; health_note: string }[]>`
      SELECT "id_document_number", "health_note" FROM "customers" WHERE "id" = ${lead.id}::uuid`;
    expect(row.id_document_number).toMatch(/^v1:/);
    expect(row.id_document_number).not.toContain(ID_NUMBER);
    expect(row.health_note).not.toContain("Đau lưng");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: lead.id, action: "lead.converted" } });
    expect(JSON.stringify(audit)).not.toContain(ID_NUMBER);
    expect(JSON.stringify(audit)).not.toContain("Đau lưng");
    expect(audit.after).toMatchObject({ idDocumentGiven: true, healthNoteGiven: true });
    // The database refuses a number that was not encrypted.
    await expect(
      prisma.customer.update({ where: { id: lead.id }, data: { idDocumentNumber: ID_NUMBER } }),
    ).rejects.toThrow();
  });

  it("hides the ID document and health note from roles that have them masked", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { reception, lead } = await bookedLead();
    await showLead(reception, lead.id, show());
    const role = await createRole(admin, {
      name: "Xem khách, ẩn giấy tờ",
      permissions: ["customer.view"],
      dataScopes: {
        leads: "ALL",
        customers: "ALL",
        contracts: "ALL",
        schedule: "ALL",
        vouchers: "ALL",
        staff: "ALL",
        tasks: "OWN",
      },
      fieldMasks: ["customer.idDocument", "customer.health"],
    });
    const { actor: viewer } = await createTestUser("RECEPTIONIST", { roleId: role.id });

    expect(await getCustomer(viewer, lead.id)).toMatchObject({
      idDocumentType: "CCCD",
      idDocumentNumber: null,
      healthNote: null,
      maskedFields: ["idDocument", "health"],
    });
  });

  it("needs the details and the consent, and a phone no one else has", async () => {
    const { reception, lead } = await bookedLead();
    const taken = uniquePhone();
    await createCustomer(reception, { fullName: "Khách cũ", phone: taken });

    await expect(showLead(reception, lead.id, show({ consent: false, email: "" }))).rejects.toMatchObject({
      fieldErrors: { consent: ["consentRequired"], email: ["invalidEmail"] },
    });
    await expect(showLead(reception, lead.id, show({ phone: taken }))).rejects.toMatchObject({
      code: "PHONE_ALREADY_USED",
    });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("LEAD");
  });

  it("converts once when two people record it at the same time; any lead still in its journey can show", async () => {
    const { reception, lead } = await bookedLead();
    const results = await Promise.allSettled([1, 2].map(() => showLead(reception, lead.id, show())));
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);

    const walkIn = await createLead(reception, { fullName: "Khách vãng lai", channelId: WHATSAPP });
    await expect(showLead(reception, walkIn.id, show())).resolves.toEqual({ customerId: walkIn.id });
  });

  it("is for those who work leads, on leads they may see", async () => {
    const { lead } = await bookedLead();
    const { actor: pt } = await createTestUser("PT");
    const { actor: other } = await createTestUser("CONSULTING");

    await expect(showLead(pt, lead.id, show())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(showLead(other, lead.id, show())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(noShowLead(other, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("No show (brief §3 stage 3, BR-204)", () => {
  it("sends a booked lead to re-care and records the step", async () => {
    const { reception, consultant, lead } = await bookedLead();

    const missed = await noShowLead(reception, lead.id);

    expect(missed).toMatchObject({ status: "NO_SHOW", appointmentAt: null, contactAgainOn: expect.any(Date) });
    const checklist = await leadChecklist(consultant, lead.id);
    expect(step(checklist, "show")).toMatchObject({ state: "DONE", result: { labelVi: "No show" } });
    expect(step(checklist, "tai-cham-soc").state).toBe("OPEN");
    expect(step(checklist, "nhac-truoc-hen-1").state).toBe("WAITING");
  });

  it("needs an appointment", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await createTestUser("CONSULTING");
    const lead = await createLead(reception, { fullName: "A", channelId: WHATSAPP });

    await expect(noShowLead(reception, lead.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });
});

describe("recording the visit on the checklist (M2 slice 4)", () => {
  it("converts with the Show result, given the Show details", async () => {
    const { consultant, lead } = await bookedLead();
    const showStep = step(await leadChecklist(consultant, lead.id), "show");

    await expect(completeLeadStep(consultant, lead.id, showStep.id, { resultIndex: 0 })).rejects.toMatchObject({
      fieldErrors: { show: ["required"] },
    });
    const done = await completeLeadStep(consultant, lead.id, showStep.id, {
      resultIndex: 0,
      show: show(),
      note: "Đến sớm",
    });

    expect(step(done, "show")).toMatchObject({ state: "DONE", result: { labelVi: "Show" }, note: "Đến sớm" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("CUSTOMER");
  });

  it("marks No show with the No show result", async () => {
    const { consultant, lead } = await bookedLead();
    const showStep = step(await leadChecklist(consultant, lead.id), "show");

    await completeLeadStep(consultant, lead.id, showStep.id, { resultIndex: 1 });

    expect((await getLead(consultant, lead.id)).status).toBe("NO_SHOW");
  });
});

describe("Báo Studio (brief §4.1, §8.2)", () => {
  async function studio() {
    const { actor: admin } = await createTestUser("ADMIN");
    const department = await createTestOption("departments", "Coach");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, studioDepartmentId: department });
    return department;
  }

  it("tells the studio's department through one task: made after the first reminder, updated after the second", async () => {
    const department = await studio();
    const { consultant, lead } = await bookedLead();
    const reminder = (key: string) => leadChecklist(consultant, lead.id).then((checklist) => step(checklist, key));

    await completeLeadStep(consultant, lead.id, (await reminder("nhac-truoc-hen-1")).id, { resultIndex: 0 });
    const task = await prisma.task.findFirstOrThrow({ where: { source: "studio", entityId: lead.id } });
    expect(task).toMatchObject({
      entityType: "lead",
      assigneeDepartmentId: department,
      assignerId: consultant.id,
      title: "Báo Studio: Nguyễn Văn An",
      dueAt: lead.appointmentAt ?? (await getLead(consultant, lead.id)).appointmentAt,
    });
    expect(task.description).toContain("Pain Status: 2.1 (Coach)");
    expect(task.description).toContain("Loại Assessment: Physical Assessment");

    await completeLeadStep(consultant, lead.id, (await reminder("nhac-truoc-hen-2")).id, { resultIndex: 1 });
    expect(await prisma.task.count({ where: { source: "studio", entityId: lead.id } })).toBe(1);
    const comments = await prisma.taskComment.findMany({ where: { taskId: task.id } });
    expect(comments.map((comment) => comment.body)).toEqual([
      expect.stringContaining("Nhắc trước hẹn lần 2: Không phản hồi"),
    ]);
    expect(step(await leadChecklist(consultant, lead.id), "bao-studio-2").state).toBe("DONE");
  });

  it("shows the task about the customer once the lead showed", async () => {
    await studio();
    const { consultant, reception, lead } = await bookedLead();
    const reminder = step(await leadChecklist(consultant, lead.id), "nhac-truoc-hen-1");
    await completeLeadStep(consultant, lead.id, reminder.id, { resultIndex: 0 });
    const task = await prisma.task.findFirstOrThrow({ where: { source: "studio", entityId: lead.id } });
    expect((await getTask(consultant, task.id)).entity).toMatchObject({
      type: "lead",
      label: expect.stringMatching(/^LD/),
    });

    await showLead(reception, lead.id, show());

    expect((await getTask(consultant, task.id)).entity).toMatchObject({
      type: "customer",
      label: expect.stringMatching(/^KH/),
    });
  });

  it("sends nothing while no department is chosen (OQ-032), and the step is still done", async () => {
    const { consultant, lead } = await bookedLead();
    const reminder = step(await leadChecklist(consultant, lead.id), "nhac-truoc-hen-1");

    const checklist = await completeLeadStep(consultant, lead.id, reminder.id, { resultIndex: 0 });

    expect(step(checklist, "bao-studio-1").state).toBe("DONE");
    expect(await prisma.task.count({ where: { source: "studio" } })).toBe(0);
  });

  it("takes only an active department for the parameter", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const inactive = await createTestOption("departments", "Cũ", false);

    await expect(
      updateParameters(admin, { ...PARAMETER_DEFAULTS, studioDepartmentId: inactive }),
    ).rejects.toMatchObject({
      fieldErrors: { studioDepartmentId: ["invalidChoice"] },
    });
    await expect(
      updateParameters(admin, { ...PARAMETER_DEFAULTS, studioDepartmentId: WHATSAPP }),
    ).rejects.toMatchObject({
      fieldErrors: { studioDepartmentId: ["invalidChoice"] },
    });
  });
});
