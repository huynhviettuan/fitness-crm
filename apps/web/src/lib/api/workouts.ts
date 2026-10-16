import "server-only";
import {
  areaListSchema,
  areaSchema,
  equipmentListSchema,
  equipmentSchema,
  exercisePageSchema,
  exerciseSchema,
  stageListSchema,
  stageSchema,
  type AreaInput,
  type EquipmentInput,
  type ExerciseInput,
  type StageInput,
} from "@gymcrm/shared/workouts";
import { api, query, read } from "./client";

// The workout catalogs (M7.1, brief §7.1): equipment, body areas, exercises and plan stages.

export async function listEquipment(includeInactive = false) {
  const { items } = await read(
    equipmentListSchema,
    (await api()).GET("/api/v1/workout/equipment", { params: { query: query({ includeInactive }) } }),
  );
  return items;
}

export async function createEquipment(input: EquipmentInput) {
  return read(equipmentSchema, (await api()).POST("/api/v1/workout/equipment", { body: input }));
}

export async function updateEquipment(id: string, input: EquipmentInput) {
  return read(
    equipmentSchema,
    (await api()).PATCH("/api/v1/workout/equipment/{id}", { params: { path: { id } }, body: input }),
  );
}

export async function listAreas(includeInactive = false) {
  const { items } = await read(
    areaListSchema,
    (await api()).GET("/api/v1/workout/areas", { params: { query: query({ includeInactive }) } }),
  );
  return items;
}

export async function createArea(input: AreaInput) {
  return read(areaSchema, (await api()).POST("/api/v1/workout/areas", { body: input }));
}

export async function updateArea(id: string, input: AreaInput) {
  return read(areaSchema, (await api()).PATCH("/api/v1/workout/areas/{id}", { params: { path: { id } }, body: input }));
}

export type ExerciseParams = {
  q?: string;
  areaId?: string;
  equipmentId?: string;
  kind?: "STRENGTH" | "CARDIO";
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listExercises(params: ExerciseParams) {
  return read(exercisePageSchema, (await api()).GET("/api/v1/workout/exercises", { params: { query: query(params) } }));
}

export async function createExercise(input: ExerciseInput) {
  return read(exerciseSchema, (await api()).POST("/api/v1/workout/exercises", { body: input }));
}

export async function updateExercise(id: string, input: ExerciseInput) {
  return read(
    exerciseSchema,
    (await api()).PATCH("/api/v1/workout/exercises/{id}", { params: { path: { id } }, body: input }),
  );
}

export async function listStages(includeInactive = false) {
  const { items } = await read(
    stageListSchema,
    (await api()).GET("/api/v1/workout/stages", { params: { query: query({ includeInactive }) } }),
  );
  return items;
}

export async function createStage(input: StageInput) {
  return read(stageSchema, (await api()).POST("/api/v1/workout/stages", { body: input }));
}

export async function updateStage(id: string, input: StageInput) {
  return read(
    stageSchema,
    (await api()).PATCH("/api/v1/workout/stages/{id}", { params: { path: { id } }, body: input }),
  );
}
