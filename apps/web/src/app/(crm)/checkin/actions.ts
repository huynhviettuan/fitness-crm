"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  createDevice,
  requestManualConfirmation,
  rotateDeviceKey,
  setMachineCode,
  updateDevice,
} from "@/lib/api/checkin";
import type { DeviceInput, MachineSubject } from "@gymcrm/shared/checkin";

/** The new machine and its key, shown once. */
export async function createDeviceAction(input: DeviceInput): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => ({ key: (await createDevice(input)).key }));
}

export async function updateDeviceAction(id: string, input: { name: string; active: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await updateDevice(id, input);
  });
}

export async function rotateDeviceKeyAction(id: string): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => ({ key: (await rotateDeviceKey(id)).key }));
}

/** D-071: the PT says the customer trained but did not scan. */
export async function requestManualConfirmationAction(bookingId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requestManualConfirmation(bookingId);
  });
}

export async function setMachineCodeAction(
  subject: MachineSubject,
  id: string,
  code: string,
): Promise<ActionResult<{ code: string | null }>> {
  return runAction(() => setMachineCode(subject, id, code));
}
