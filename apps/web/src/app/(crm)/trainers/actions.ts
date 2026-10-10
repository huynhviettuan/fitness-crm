"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createTrainer, updateTrainer } from "@/lib/api/trainers";
import type { TrainerInput } from "@flow/shared/trainers";

export async function createTrainerAction(input: TrainerInput): Promise<ActionResult<{ trainerCode: string }>> {
  return runAction(async () => {
    const trainer = await createTrainer(input);
    return { trainerCode: trainer.trainerCode };
  });
}

export async function updateTrainerAction(id: string, input: TrainerInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateTrainer(id, input);
  });
}
