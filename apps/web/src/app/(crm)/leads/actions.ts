"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { addManagerAudit } from "@/lib/api/lead-audit";
import {
  addInquiry,
  addLeadNote,
  assignLead,
  changeLeadStatus,
  completeLeadStep,
  createLead,
  reopenLeadStep,
  mergePersons,
  noShowLead,
  showLead,
  updateLead,
} from "@/lib/api/leads";
import type {
  LeadAssignInput,
  LeadInput,
  LeadInquiryInput,
  LeadNoteInput,
  ManagerAuditInput,
  MergeInput,
  LeadStatusChangeInput,
  LeadUpdateInput,
  StepCompleteInput,
  StepReopenInput,
  ShowInput,
} from "@gymcrm/shared/leads";

export async function createLeadAction(input: LeadInput): Promise<ActionResult<{ id: string; leadCode: string }>> {
  return runAction(async () => {
    const lead = await createLead(input);
    return { id: lead.id, leadCode: lead.leadCode };
  });
}

export async function updateLeadAction(id: string, input: LeadUpdateInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateLead(id, input);
  });
}

export async function changeLeadStatusAction(id: string, input: LeadStatusChangeInput): Promise<ActionResult> {
  return runAction(async () => {
    await changeLeadStatus(id, input);
  });
}

export async function assignLeadAction(id: string, input: LeadAssignInput): Promise<ActionResult> {
  return runAction(async () => {
    await assignLead(id, input);
  });
}

export async function completeLeadStepAction(
  id: string,
  stepId: string,
  input: StepCompleteInput,
): Promise<ActionResult> {
  return runAction(async () => {
    await completeLeadStep(id, stepId, input);
  });
}

export async function reopenLeadStepAction(id: string, stepId: string, input: StepReopenInput): Promise<ActionResult> {
  return runAction(async () => {
    await reopenLeadStep(id, stepId, input);
  });
}

/** Returns the customer's id: after Show the record is a customer (D-019). */
export async function showLeadAction(id: string, input: ShowInput): Promise<ActionResult<{ customerId: string }>> {
  return runAction(async () => showLead(id, input));
}

export async function noShowLeadAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await noShowLead(id);
  });
}

/** The duplicate dialog's "Gộp vào hồ sơ này": the inquiry goes to the existing record (BR-202, A-063). */
export async function addInquiryAction(
  personId: string,
  input: LeadInquiryInput,
): Promise<ActionResult<{ id: string; stage: "LEAD" | "CUSTOMER"; code: string }>> {
  return runAction(async () => {
    const result = await addInquiry(personId, input);
    return { id: result.personId, stage: result.stage, code: result.code };
  });
}

/** Returns the surviving record, which may be the other one (A-064). */
export async function mergePersonsAction(
  id: string,
  input: MergeInput,
): Promise<ActionResult<{ survivorId: string; stage: "LEAD" | "CUSTOMER" }>> {
  return runAction(async () => {
    const result = await mergePersons(id, input);
    return { survivorId: result.survivorId, stage: result.stage };
  });
}

export async function addLeadNoteAction(id: string, input: LeadNoteInput): Promise<ActionResult> {
  return runAction(async () => {
    await addLeadNote(id, input);
  });
}

export async function addManagerAuditAction(id: string, input: ManagerAuditInput): Promise<ActionResult> {
  return runAction(async () => {
    await addManagerAudit(id, input);
  });
}
