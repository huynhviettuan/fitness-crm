"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { addTaskComment, createTask, moveTask, updateTask, type TaskMove } from "@/lib/api/tasks";
import type { TaskCommentInput, TaskInput, TaskUpdateInput } from "@gymcrm/shared/tasks";

export async function createTaskAction(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ({ id: (await createTask(input)).id }));
}

export async function updateTaskAction(id: string, input: TaskUpdateInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateTask(id, input);
  });
}

export async function moveTaskAction(id: string, move: TaskMove): Promise<ActionResult> {
  return runAction(async () => {
    await moveTask(id, move);
  });
}

export async function addTaskCommentAction(id: string, input: TaskCommentInput): Promise<ActionResult> {
  return runAction(async () => {
    await addTaskComment(id, input);
  });
}
