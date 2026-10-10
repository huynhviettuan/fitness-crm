import { z } from "zod";
import { DATA_SCOPE_RESOURCES, type Permission } from "@flow/shared/permissions";
import { cloneRoleSchema, roleInputSchema, type Role } from "@flow/shared/roles";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { isUniqueViolation } from "../db/errors.js";
import { prisma, type Db } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { assertCan, assertCanAny } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";

// Roles are configuration (D-017, FR-PLT-002): admin creates, edits, and clones them on
// screen, and every change applies to the role's users on their next request (AC-02).

const roleInclude = {
  permissions: { select: { permission: true } },
  dataScopes: { select: { resource: true, scope: true } },
  fieldMasks: { select: { field: true } },
  _count: { select: { users: true } },
} as const satisfies Prisma.RoleInclude;

type RoleRecord = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

/** Also for the user screens, which choose a role (FR-PLT-001). */
export async function listRoles(actor: Actor): Promise<Role[]> {
  assertCanAny(actor, ["role.manage", "user.manage"]);
  const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: "asc" } });
  return roles.map(toRole);
}

export async function getRole(actor: Actor, id: string): Promise<Role> {
  assertCan(actor, "role.manage");
  return toRole(await findOrThrow(prisma, id));
}

export async function createRole(actor: Actor, input: unknown): Promise<Role> {
  assertCan(actor, "role.manage");
  const data = parseInput(roleInputSchema, input);
  return withNameConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { name: data.name, description: data.description } });
      await writeConfiguration(tx, role.id, data);
      await recordAudit(tx, { actorUserId: actor.id, entityType: "role", entityId: role.id, action: "role.created", after: data });
      return toRole(await findOrThrow(tx, role.id));
    }),
  );
}

/**
 * Replaces the role's name, permissions, data scopes, and hidden fields. Admins cannot
 * take user or role management away from their own role, so they never lock themselves
 * out.
 */
export async function updateRole(actor: Actor, id: string, input: unknown): Promise<Role> {
  assertCan(actor, "role.manage");
  const data = parseInput(roleInputSchema, input);
  if (id === actor.roleId) {
    const kept = new Set<Permission>(data.permissions);
    if (!kept.has("role.manage") || !kept.has("user.manage")) throw new AppError("CANNOT_CHANGE_OWN_ACCESS");
  }
  return withNameConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = toRole(await findOrThrow(tx, id));
      await tx.role.update({ where: { id }, data: { name: data.name, description: data.description } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.roleDataScope.deleteMany({ where: { roleId: id } });
      await tx.roleFieldMask.deleteMany({ where: { roleId: id } });
      await writeConfiguration(tx, id, data);
      const after = toRole(await findOrThrow(tx, id));
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "role",
        entityId: id,
        action: "role.updated",
        before: configurationOf(before),
        after: configurationOf(after),
      });
      return after;
    }),
  );
}

/** A copy under a new name, to adjust from there (FR-PLT-002). */
export async function cloneRole(actor: Actor, id: string, input: unknown): Promise<Role> {
  assertCan(actor, "role.manage");
  const { name } = parseInput(cloneRoleSchema, input);
  return withNameConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const source = toRole(await findOrThrow(tx, id));
      const role = await tx.role.create({ data: { name, description: source.description, clonedFromId: source.id } });
      await writeConfiguration(tx, role.id, source);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "role",
        entityId: role.id,
        action: "role.cloned",
        after: configurationOf(source),
        context: { clonedFrom: source.id },
      });
      return toRole(await findOrThrow(tx, role.id));
    }),
  );
}

async function writeConfiguration(db: Db, roleId: string, data: Pick<Role, "permissions" | "dataScopes" | "fieldMasks">) {
  await db.rolePermission.createMany({ data: data.permissions.map((permission) => ({ roleId, permission })) });
  await db.roleDataScope.createMany({
    data: DATA_SCOPE_RESOURCES.map((resource) => ({ roleId, resource, scope: data.dataScopes[resource] ?? "OWN" })),
  });
  await db.roleFieldMask.createMany({ data: data.fieldMasks.map((field) => ({ roleId, field })) });
}

async function findOrThrow(db: Db, id: string): Promise<RoleRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const role = await db.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) throw new AppError("NOT_FOUND");
  return role;
}

function toRole(role: RoleRecord): Role {
  const scopes = new Map(role.dataScopes.map((row) => [row.resource, row.scope]));
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((p) => p.permission).sort() as Role["permissions"],
    dataScopes: Object.fromEntries(DATA_SCOPE_RESOURCES.map((resource) => [resource, scopes.get(resource) ?? "OWN"])) as Role["dataScopes"],
    fieldMasks: role.fieldMasks.map((m) => m.field).sort() as Role["fieldMasks"],
    userCount: role._count.users,
  };
}

function configurationOf(role: Role) {
  return { name: role.name, permissions: role.permissions, dataScopes: role.dataScopes, fieldMasks: role.fieldMasks };
}

async function withNameConflictsMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("VALIDATION_FAILED", { fieldErrors: { name: ["nameAlreadyUsed"] } });
    throw error;
  }
}
