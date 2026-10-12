import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES } from "@flow/shared/permissions";
import { prisma } from "../../src/platform/db/prisma.js";
import { leadTimeline } from "../../src/modules/leads/lead-journey.service.js";
import { addLeadNote } from "../../src/modules/leads/lead-note.service.js";
import { leadChecklist } from "../../src/modules/leads/checklist.service.js";
import { changeLeadStatus } from "../../src/modules/leads/lead-journey.service.js";
import { showLead } from "../../src/modules/leads/lead-outcome.service.js";
import { resetDatabase } from "../support/database.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { actorOf, createTestUser, withoutApprovals } from "../support/factories.js";
import { newLead } from "../support/leads.js";

// Notes on a lead (brief §4.1, FR-LEAD-006, A-074) and the Consulting history of a customer (A-076).

afterEach(resetDatabase);

const noteEntries = (timeline: { items: { kind: string }[] }) =>
  timeline.items.filter((entry) => entry.kind === "note") as {
    kind: "note";
    id: string;
    body: string;
    by: { id: string };
  }[];

describe("lead notes (A-074)", () => {
  it("adds a note with its author to the timeline, newest first, and audits that one was added", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(reception, "Phạm Văn Nam");

    const first = await addLeadNote(consultant, lead.id, { body: "Khách muốn tập buổi sáng." });
    const second = await addLeadNote(reception, lead.id, { body: "  Đã gọi lại, hẹn thứ Bảy.  " });

    expect(second).toMatchObject({ kind: "note", body: "Đã gọi lại, hẹn thứ Bảy.", by: { id: reception.id } });
    const notes = noteEntries(await leadTimeline(consultant, lead.id));
    expect(notes.map((note) => note.id)).toEqual([second.id, first.id]);
    expect(notes[1]).toMatchObject({ body: "Khách muốn tập buổi sáng.", by: { id: consultant.id } });
    const audit = await prisma.auditEvent.findMany({ where: { entityId: lead.id, action: "lead.note_added" } });
    expect(audit).toHaveLength(2);
    // The note's text is not copied into the history (it may hold health details).
    expect(JSON.stringify(audit)).not.toContain("Khách muốn tập buổi sáng");
  });

  it("refuses an empty or oversized note and one with control characters", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    const lead = await newLead(actor, "Lê Thị Hoa");

    await expect(addLeadNote(actor, lead.id, { body: "   " })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { body: ["required"] },
    });
    await expect(addLeadNote(actor, lead.id, { body: "x".repeat(2001) })).rejects.toMatchObject({
      fieldErrors: { body: ["tooLong"] },
    });
    await expect(addLeadNote(actor, lead.id, { body: "a\u0000b" })).rejects.toMatchObject({
      fieldErrors: { body: ["invalidCharacters"] },
    });
    expect(await prisma.leadNote.count()).toBe(0);
  });

  it("needs lead.manage to add and lead.view to read", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const lead = await newLead(reception, "Đỗ Minh Tuấn");
    const { actor: accountant } = await createTestUser("ACCOUNTANT");

    await expect(addLeadNote(accountant, lead.id, { body: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(leadTimeline(accountant, lead.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not show a note on a lead the user cannot see", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const lead = await newLead(reception, "Vũ Thị Lan");
    const { actor: other } = await createTestUser("CONSULTING", { branchIds: [] });

    await expect(addLeadNote(other, lead.id, { body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(leadTimeline(other, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not edited or deleted: no operation changes an existing note", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");
    const lead = await newLead(actor, "Ngô Gia Bảo");
    const note = await addLeadNote(actor, lead.id, { body: "Ghi chú gốc" });

    await addLeadNote(actor, lead.id, { body: "Sửa: khách đổi ý" });

    expect((await prisma.leadNote.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("Ghi chú gốc");
    expect(await prisma.leadNote.count()).toBe(2);
  });
});

describe("the consulting history of a customer (A-076)", () => {
  async function shownLead() {
    await withoutApprovals();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(reception, "Hoàng Thị Mai");
    await addLeadNote(consultant, lead.id, { body: "Muốn giảm cân." });
    await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:30",
    });
    await showLead(reception, lead.id, {
      idDocumentType: "CCCD",
      idDocumentNumber: "079123456789",
      birthDate: "01/02/1990",
      countryCode: "VN",
      email: "mai@example.com",
      phone: "0909111222",
      consent: true,
    });
    return { reception, consultant, lead };
  }

  it("keeps the notes, status changes, and checklist readable after Show, to someone who can see the customer", async () => {
    const { reception, lead } = await shownLead();

    const timeline = await leadTimeline(reception, lead.id);
    const checklist = await leadChecklist(reception, lead.id);

    expect(noteEntries(timeline).map((note) => note.body)).toEqual(["Muốn giảm cân."]);
    expect(timeline.items.some((entry) => entry.kind === "status")).toBe(true);
    expect(checklist.items.length).toBeGreaterThan(0);
  });

  it("is hidden from someone without customer.view, and notes cannot be added to a customer", async () => {
    const { reception, consultant, lead } = await shownLead();
    // Sees leads but not customers.
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: `Vai trò ${randomUUID().slice(0, 8)}`,
      permissions: ["lead.view"],
      dataScopes: Object.fromEntries(DATA_SCOPE_RESOURCES.map((r) => [r, "ALL"])),
      fieldMasks: [],
    });
    const { user } = await createTestUser("RECEPTIONIST", { roleId: role.id });
    const leadsOnly = await actorOf(user.id);

    await expect(addLeadNote(reception, lead.id, { body: "Sau Show" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(leadTimeline(leadsOnly, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The consultant keeps no access to the person once they are a customer (A-068): that is customer.view.
    await expect(leadTimeline(consultant, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
