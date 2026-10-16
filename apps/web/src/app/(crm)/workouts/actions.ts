"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createPlan, reviewPlan, revisePlan, submitPlan, updatePlan } from "@/lib/api/workout-plans";
import type { PlanContentInput, PlanCreateInput, PlanReviewInput } from "@gymcrm/shared/workouts";

// The writes of workout plans and templates (M7.2): each answers the plan's id so the screen can open it.

export async function createPlanAction(input: PlanCreateInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ({ id: (await createPlan(input)).id }));
}

export async function savePlanAction(id: string, input: PlanContentInput): Promise<ActionResult> {
  return runAction(async () => {
    await updatePlan(id, input);
  });
}

/** Saves, then sends to the Master, so what is sent is what is on screen. */
export async function saveAndSubmitPlanAction(
  id: string,
  input: PlanContentInput,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => {
    await updatePlan(id, input);
    return { pending: (await submitPlan(id)).status === "PENDING" };
  });
}

export async function revisePlanAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ({ id: (await revisePlan(id)).id }));
}

export async function reviewPlanAction(id: string, input: PlanReviewInput): Promise<ActionResult> {
  return runAction(async () => {
    await reviewPlan(id, input);
  });
}
