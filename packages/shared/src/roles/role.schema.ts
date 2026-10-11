import { z } from "zod";
import {
  DATA_SCOPES,
  DATA_SCOPE_RESOURCES,
  MASKABLE_FIELDS,
  PERMISSION_KEYS,
  type DataScope,
  type DataScopeResource,
} from "../permissions/index.js";
import { hasNoControlCharacters, listOf } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

const name = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(100, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

const description = z
  .string()
  .trim()
  .max(500, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" })
  .transform((value) => (value === "" ? null : value))
  .prefault("");

const dataScopes = z.object(
  Object.fromEntries(
    DATA_SCOPE_RESOURCES.map((resource) => [resource, z.enum(DATA_SCOPES, { error: "invalidChoice" })]),
  ) as Record<DataScopeResource, z.ZodEnum<{ ALL: "ALL"; OWN: "OWN" }>>,
);

/**
 * A role as admin edits it (FR-PLT-002): the ticked permissions, a data scope for every
 * resource, and the hidden fields. Lists replace what the role had.
 */
export const roleInputSchema = z.object({
  name,
  description,
  permissions: z.array(z.enum(PERMISSION_KEYS, { error: "invalidChoice" })).transform((keys) => [...new Set(keys)]),
  dataScopes,
  fieldMasks: z.array(z.enum(MASKABLE_FIELDS, { error: "invalidChoice" })).transform((fields) => [...new Set(fields)]),
});

/** A copy under a new name, to adjust from there. */
export const cloneRoleSchema = z.object({ name });

export const roleSchema = z
  .object({
    id: z.uuid(),
    /** Set on the default roles of 09_RBAC.md; null for roles admin created. */
    code: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.enum(PERMISSION_KEYS)),
    dataScopes: z.record(z.enum(DATA_SCOPE_RESOURCES), z.enum(DATA_SCOPES)),
    fieldMasks: z.array(z.enum(MASKABLE_FIELDS)),
    userCount: z.int(),
  })
  .meta({ id: "Role" });

export const roleListSchema = listOf(roleSchema).meta({ id: "RoleList" });

export type RoleInput = z.input<typeof roleInputSchema>;
export type Role = z.output<typeof roleSchema>;
export type DataScopes = Record<DataScopeResource, DataScope>;
