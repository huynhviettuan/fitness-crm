"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { createTrainer, updateTrainer } from "@/modules/trainers/trainer.service";
import type { TrainerInput } from "@/modules/trainers/trainer.schema";

export async function createTrainerAction(input: TrainerInput): Promise<ActionResult<{ trainerCode: string }>> {
  return runAction(async () => {
    const user = await requireActionUser();
    const trainer = await createTrainer(user, input);
    return { trainerCode: trainer.trainerCode };
  });
}

export async function updateTrainerAction(id: string, input: TrainerInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await updateTrainer(user, id, input);
  });
}
