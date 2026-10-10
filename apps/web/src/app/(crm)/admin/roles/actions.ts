"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { cloneRole, createRole, updateRole } from "@/lib/api/roles";

export async function createRoleAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const role = await createRole(input);
    return { id: role.id, name: role.name };
  });
}

export async function updateRoleAction(id: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await updateRole(id, input);
  });
}

export async function cloneRoleAction(id: string, input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const role = await cloneRole(id, input);
    return { id: role.id, name: role.name };
  });
}
