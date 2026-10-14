"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  cancelBooking,
  completeDay,
  burnShow,
  createBooking,
  deleteBooking,
  deleteTrainedSession,
  markNoShow,
  rescheduleBooking,
  checkIn,
  completeSession,
} from "@/lib/api/bookings";
import type { BookingInput, BurnShowInput, CompleteDayResult, RescheduleInput } from "@flow/shared/bookings";
import type { DeleteInput } from "@flow/shared/trash";

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

export async function deleteBookingAction(
  id: string,
  input: DeleteInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => {
    await deleteBooking(id, input);
    return { submitted: false };
  });
}

/** Delete a trained session from the check-in history (M5.4, D-026). */
export async function deleteTrainedSessionAction(
  id: string,
  input: DeleteInput,
): Promise<ActionResult<{ submitted: boolean }>> {
  return runAction(async () => {
    await deleteTrainedSession(id, input);
    return { submitted: false };
  });
}

/** Burn Show (M5.4, D-028); returns the contract's sessions left after it. */
export async function burnShowAction(input: BurnShowInput): Promise<ActionResult<{ remaining: number }>> {
  return runAction(async () => {
    const booking = await burnShow(input);
    return { remaining: booking.contract.remainingSessions };
  });
}

/** Bulk "Đã tập" for a day (M5.3): the sessions the admin confirmed in the list. */
export async function completeDayAction(bookingIds: string[]): Promise<ActionResult<CompleteDayResult>> {
  return runAction(() => completeDay(bookingIds));
}
