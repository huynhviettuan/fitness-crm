import "server-only";
import {
  dayOffSchema,
  employeeLoginListSchema,
  employeePageSchema,
  employeeSchema,
  trainerDayListSchema,
  workScheduleSchema,
  type DayOffInput,
  type EmployeeInput,
  type EmployeeStatus,
  type ShiftsInput,
} from "@flow/shared/employees";
import { api, done, query, read } from "./client";

// Employees and their working schedules (brief §8.4, D-030).

export type EmployeeQuery = {
  q?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  trainersOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listEmployees(params: EmployeeQuery = {}) {
  return read(employeePageSchema, (await api()).GET("/api/v1/employees", { params: { query: query(params) } }));
}

export async function getEmployee(id: string) {
  return read(employeeSchema, (await api()).GET("/api/v1/employees/{id}", { params: { path: { id } } }));
}

/** Logins to link, and the employee each already belongs to. */
export async function listEmployeeLogins() {
  const { items } = await read(employeeLoginListSchema, (await api()).GET("/api/v1/employees/logins"));
  return items;
}

export async function createEmployee(input: EmployeeInput) {
  return read(employeeSchema, (await api()).POST("/api/v1/employees", { body: input as never }));
}

export async function updateEmployee(id: string, input: EmployeeInput) {
  return read(employeeSchema, (await api()).PATCH("/api/v1/employees/{id}", { params: { path: { id } }, body: input as never }));
}

export async function getWorkSchedule(id: string) {
  return read(workScheduleSchema, (await api()).GET("/api/v1/employees/{id}/schedule", { params: { path: { id } } }));
}

export async function replaceShifts(id: string, input: ShiftsInput) {
  return read(workScheduleSchema, (await api()).PUT("/api/v1/employees/{id}/shifts", { params: { path: { id } }, body: input }));
}

export async function addDayOff(id: string, input: DayOffInput) {
  return read(dayOffSchema, (await api()).POST("/api/v1/employees/{id}/days-off", { params: { path: { id } }, body: input }));
}

export async function removeDayOff(id: string, dayOffId: string) {
  return done((await api()).DELETE("/api/v1/employees/{id}/days-off/{dayOffId}", { params: { path: { id, dayOffId } } }));
}

/** The PT calendar's trainers for one gym day (dd/MM/yyyy), with their working hours. */
export async function listTrainersOfDay(date: string) {
  const { items } = await read(trainerDayListSchema, (await api()).GET("/api/v1/schedule/trainers", { params: { query: { date } } }));
  return items;
}
