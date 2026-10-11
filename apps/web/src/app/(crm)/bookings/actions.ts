"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  cancelBooking,
  createBooking,
  markNoShow,
  rescheduleBooking,
  checkIn,
  completeSession,
} from "@/lib/api/bookings";
import type { BookingInput, RescheduleInput } from "@flow/shared/bookings";

export async function createBookingAction(input: BookingInput): Promise<ActionResult> {
  return runAction(async () => {
    await createBooking(input);
  });
}

export async function rescheduleBookingAction(id: string, input: RescheduleInput): Promise<ActionResult> {
  return runAction(async () => {
    await rescheduleBooking(id, input);
  });
}

export async function cancelBookingAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelBooking(id);
  });
}

export async function markNoShowAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await markNoShow(id);
  });
}

export async function checkInAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await checkIn(id);
  });
}

/** Returns the contract's new remaining sessions to show after completion (docs/08). */
export async function completeSessionAction(id: string): Promise<ActionResult<{ remainingSessions: number }>> {
  return runAction(async () => {
    const { contract } = await completeSession(id);
    return { remainingSessions: contract.remainingSessions };
  });
}
