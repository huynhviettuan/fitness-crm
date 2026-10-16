"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import {
  createArea,
  createEquipment,
  createExercise,
  createStage,
  updateArea,
  updateEquipment,
  updateExercise,
  updateStage,
} from "@/lib/api/workouts";
import type { AreaInput, EquipmentInput, ExerciseInput, StageInput } from "@gymcrm/shared/workouts";

// One action per save: with an id it edits, without it adds (M7.1).

export async function saveEquipmentAction(id: string | null, input: EquipmentInput): Promise<ActionResult> {
  return runAction(async () => {
    if (id) await updateEquipment(id, input);
    else await createEquipment(input);
  });
}

export async function saveAreaAction(id: string | null, input: AreaInput): Promise<ActionResult> {
  return runAction(async () => {
    if (id) await updateArea(id, input);
    else await createArea(input);
  });
}

export async function saveExerciseAction(id: string | null, input: ExerciseInput): Promise<ActionResult> {
  return runAction(async () => {
    if (id) await updateExercise(id, input);
    else await createExercise(input);
  });
}

export async function saveStageAction(id: string | null, input: StageInput): Promise<ActionResult> {
  return runAction(async () => {
    if (id) await updateStage(id, input);
    else await createStage(input);
  });
}
