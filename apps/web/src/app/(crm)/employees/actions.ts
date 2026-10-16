"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { addDayOff, createEmployee, removeDayOff, replaceShifts, updateEmployee } from "@/lib/api/employees";
import type { DayOffInput, EmployeeInput, ShiftsInput } from "@gymcrm/shared/employees";

export async function createEmployeeAction(
  input: EmployeeInput,
): Promise<ActionResult<{ id: string; employeeCode: string }>> {
  return runAction(async () => {
    const employee = await createEmployee(input);
    return { id: employee.id, employeeCode: employee.employeeCode };
  });
}

export async function updateEmployeeAction(id: string, input: EmployeeInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateEmployee(id, input);
  });
}

export async function replaceShiftsAction(id: string, input: ShiftsInput): Promise<ActionResult> {
  return runAction(async () => {
    await replaceShifts(id, input);
  });
}

export async function addDayOffAction(id: string, input: DayOffInput): Promise<ActionResult> {
  return runAction(async () => {
    await addDayOff(id, input);
  });
}

export async function removeDayOffAction(id: string, dayOffId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeDayOff(id, dayOffId);
  });
}
