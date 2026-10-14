import "server-only";
import {
  workoutDashboardSchema,
  workoutDrillSchema,
  workoutProgressSchema,
  type DashboardKind,
} from "@flow/shared/workouts";
import { api, query, read } from "./client";

// The weekly workout dashboard and a customer's progress (M7.5, brief §7.5, §9).

export type WorkoutDashboardParams = { week?: string; branchId?: string };
export type WorkoutDrillParams = WorkoutDashboardParams & {
  kind: DashboardKind;
  optionId?: string;
  page?: number;
  pageSize?: number;
};

export async function getWorkoutDashboard(params: WorkoutDashboardParams) {
  return read(
    workoutDashboardSchema,
    (await api()).GET("/api/v1/reports/workouts", { params: { query: query(params) } }),
  );
}

export async function getWorkoutDrill(params: WorkoutDrillParams) {
  return read(
    workoutDrillSchema,
    (await api()).GET("/api/v1/reports/workouts/sets", { params: { query: query(params) } }),
  );
}

export async function getWorkoutProgress(customerId: string) {
  return read(
    workoutProgressSchema,
    (await api()).GET("/api/v1/workout/progress/{customerId}", { params: { path: { customerId } } }),
  );
}
