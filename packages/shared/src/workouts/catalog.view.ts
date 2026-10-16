import { z } from "zod";
import { instant, listOf, pageOf } from "../validation/index.js";
import { EXERCISE_KINDS } from "./catalog.domain.js";

export const equipmentSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    notes: z.string().nullable(),
    active: z.boolean(),
    /** Exercises that use it. */
    exercises: z.int(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutEquipment" });
export const equipmentListSchema = listOf(equipmentSchema).meta({ id: "WorkoutEquipmentList" });

export const areaSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    parentId: z.uuid().nullable(),
    /** The names from the top down, e.g. "Thân dưới › Đùi". */
    path: z.string(),
    /** 1 for a top-level area. */
    depth: z.int(),
    notes: z.string().nullable(),
    active: z.boolean(),
    exercises: z.int(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutArea" });
/** The tree in reading order: each area is followed by what is below it. */
export const areaListSchema = listOf(areaSchema).meta({ id: "WorkoutAreaList" });

export const exerciseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(EXERCISE_KINDS),
    area: z.object({ id: z.uuid(), code: z.string(), name: z.string(), path: z.string() }),
    equipment: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    description: z.string().nullable(),
    videoUrl: z.string().nullable(),
    active: z.boolean(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutExercise" });
export const exercisePageSchema = pageOf(exerciseSchema).meta({ id: "WorkoutExercisePage" });

export const stageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutStage" });
export const stageListSchema = listOf(stageSchema).meta({ id: "WorkoutStageList" });

export type Equipment = z.output<typeof equipmentSchema>;
export type Area = z.output<typeof areaSchema>;
export type Exercise = z.output<typeof exerciseSchema>;
export type ExercisePage = z.output<typeof exercisePageSchema>;
export type Stage = z.output<typeof stageSchema>;
