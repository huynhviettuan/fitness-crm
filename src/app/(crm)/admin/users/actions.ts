"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import {
  changeUserRole,
  createUser,
  resetUserPassword,
  setUserStatus,
} from "@/modules/users/user.service";

export async function createUserAction(input: unknown): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const actor = await requireActionUser();
    const user = await createUser(actor, input);
    return { name: user.name };
  });
}

export async function changeUserRoleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await changeUserRole(await requireActionUser(), input);
  });
}

export async function setUserStatusAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await setUserStatus(await requireActionUser(), input);
  });
}

export async function resetUserPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await resetUserPassword(await requireActionUser(), input);
  });
}
