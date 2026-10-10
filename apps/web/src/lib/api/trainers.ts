import "server-only";
import { trainerListSchema, trainerLoginListSchema, trainerSchema, type TrainerInput } from "@flow/shared/trainers";
import { api, query, read } from "./client";

export async function listTrainers(params: { activeOnly?: boolean } = {}) {
  const { items } = await read(trainerListSchema, (await api()).GET("/api/v1/trainers", { params: { query: query(params) } }));
  return items;
}

/** Logins that can be linked to a trainer record (A-010). */
export async function listTrainerLogins() {
  const { items } = await read(trainerLoginListSchema, (await api()).GET("/api/v1/trainers/logins"));
  return items;
}

export async function createTrainer(input: TrainerInput) {
  return read(trainerSchema, (await api()).POST("/api/v1/trainers", { body: input }));
}

export async function updateTrainer(id: string, input: TrainerInput) {
  return read(trainerSchema, (await api()).PATCH("/api/v1/trainers/{id}", { params: { path: { id } }, body: input }));
}
