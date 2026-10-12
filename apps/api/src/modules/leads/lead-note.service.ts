import { leadNoteInputSchema, type LeadNote } from "@flow/shared/leads";
import { prisma } from "../../platform/db/prisma.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./lead.repository.js";
import { visibleLead } from "./lead.present.js";

// Notes on a lead (brief §4.1, A-074): dated, with the author, shown on the timeline. They
// are append-only; a correction is a new note.

export function noteView(note: repo.NoteRecord): LeadNote {
  return { kind: "note", id: note.id, at: note.createdAt, by: note.author, body: note.body };
}

/** Adds a note to a lead the actor can see. The audit records that it was added, not what it says. */
export async function addLeadNote(actor: Actor, leadId: string, input: unknown): Promise<LeadNote> {
  assertCan(actor, "lead.manage");
  const { body } = parseInput(leadNoteInputSchema, input);
  return prisma.$transaction(async (tx) => {
    const lead = await visibleLead(tx, actor, leadId);
    const note = await repo.addNote(tx, { personId: lead.id, body, createdBy: actor.id });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "lead",
      entityId: lead.id,
      action: "lead.note_added",
      after: { noteId: note.id },
    });
    return noteView(note);
  });
}
