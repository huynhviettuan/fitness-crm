"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { changeUserRole, createUser, resetUserPassword, setUserStatus } from "@/lib/api/users";

/** The forms send the target user's id with the other fields; the API takes it in the path. */
function split(input: unknown): { userId: string; body: unknown } {
  if (input && typeof input === "object" && "userId" in input && typeof input.userId === "string") {
    const { userId, ...body } = input;
    return { userId, body };
  }
  return { userId: "-", body: input };
}

export async function createUserAction(input: unknown): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const user = await createUser(input);
    return { name: user.name };
  });
}

export async function changeUserRoleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId, body } = split(input);
    await changeUserRole(userId, body);
  });
}

export async function setUserStatusAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId, body } = split(input);
    await setUserStatus(userId, body);
  });
}

export async function resetUserPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { userId, body } = split(input);
    await resetUserPassword(userId, body);
  });
}
