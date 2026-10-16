"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  createClass,
  enrollCustomer,
  getClassSession,
  markAttendee,
  removeAttendee,
  updateClass,
} from "@/lib/api/classes";
import type {
  ClassInput,
  ClassSession,
  ClassUpdateInput,
  EnrollInput,
  MarkAttendanceInput,
} from "@gymcrm/shared/classes";

export async function createClassAction(input: ClassInput): Promise<ActionResult> {
  return runAction(async () => {
    await createClass(input);
  });
}

export async function updateClassAction(id: string, input: ClassUpdateInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateClass(id, input);
  });
}

/** The class session with its seats, for the sheet. */
export async function getClassSessionAction(id: string): Promise<ActionResult<ClassSession>> {
  return runAction(() => getClassSession(id));
}

export async function enrollAction(id: string, input: EnrollInput): Promise<ActionResult<ClassSession>> {
  return runAction(() => enrollCustomer(id, input));
}

export async function removeAttendeeAction(id: string, attendeeId: string): Promise<ActionResult<ClassSession>> {
  return runAction(() => removeAttendee(id, attendeeId));
}

export async function markAttendeeAction(
  id: string,
  attendeeId: string,
  input: MarkAttendanceInput,
): Promise<ActionResult<ClassSession>> {
  return runAction(() => markAttendee(id, attendeeId, input));
}
