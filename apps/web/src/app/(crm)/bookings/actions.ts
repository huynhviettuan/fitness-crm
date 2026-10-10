"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { cancelBooking, createBooking, markNoShow, rescheduleBooking } from "@/modules/bookings/booking.service";
import type { BookingInput, RescheduleInput } from "@flow/shared/bookings";
import { checkIn, completeSession } from "@/modules/sessions/session.service";

export async function createBookingAction(input: BookingInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await createBooking(user, input);
  });
}

export async function rescheduleBookingAction(id: string, input: RescheduleInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await rescheduleBooking(user, id, input);
  });
}

export async function cancelBookingAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await cancelBooking(user, id);
  });
}

export async function markNoShowAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await markNoShow(user, id);
  });
}

export async function checkInAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await checkIn(user, id);
  });
}

/** Returns the contract's new remaining sessions to show after completion (docs/08). */
export async function completeSessionAction(id: string): Promise<ActionResult<{ remainingSessions: number }>> {
  return runAction(async () => {
    const user = await requireActionUser();
    const { contract } = await completeSession(user, id);
    return { remainingSessions: contract.remainingSessions };
  });
}
