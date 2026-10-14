import "server-only";
import {
  planPageSchema,
  planSchema,
  type PlanContentInput,
  type PlanCreateInput,
  type PlanReviewInput,
} from "@flow/shared/workouts";
import { api, query, read } from "./client";
import { listExercises } from "./workouts";

// Workout plans and templates (M7.2, brief §7.2).

export type PlanParams = {
  kind?: "TEMPLATE" | "CUSTOMER";
  status?: string;
  customerId?: string;
  trainerId?: string;
  q?: string;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listPlans(params: PlanParams) {
  return read(planPageSchema, (await api()).GET("/api/v1/workout/plans", { params: { query: query(params) } }));
}

export async function getPlan(id: string) {
  return read(planSchema, (await api()).GET("/api/v1/workout/plans/{id}", { params: { path: { id } } }));
}

export async function createPlan(input: PlanCreateInput) {
  return read(planSchema, (await api()).POST("/api/v1/workout/plans", { body: input as never }));
}

export async function updatePlan(id: string, input: PlanContentInput) {
  return read(planSchema, (await api()).PUT("/api/v1/workout/plans/{id}", { params: { path: { id } }, body: input }));
}

export async function submitPlan(id: string) {
  return read(planSchema, (await api()).POST("/api/v1/workout/plans/{id}/submit", { params: { path: { id } } }));
}

export async function revisePlan(id: string) {
  return read(planSchema, (await api()).POST("/api/v1/workout/plans/{id}/revise", { params: { path: { id } } }));
}

export async function reviewPlan(id: string, input: PlanReviewInput) {
  return read(
    planSchema,
    (await api()).PUT("/api/v1/workout/plans/{id}/review", { params: { path: { id } }, body: input }),
  );
}

/** Every active exercise, for the picker of the plan editor (the catalog is small: a few hundred). */
export async function listPickableExercises() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const result = await listExercises({ page, pageSize: 100 });
    all.push(...result.items);
    if (all.length >= result.total) break;
  }
  return all;
}
