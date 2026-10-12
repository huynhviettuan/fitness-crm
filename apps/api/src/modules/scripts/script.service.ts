import { z } from "zod";
import {
  listScriptsQuerySchema,
  scriptInputSchema,
  scriptOrderSchema,
  type ConsultingScript,
} from "@flow/shared/leads";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./script.repository.js";

// The consulting script library (brief §4.1, FR-LEAD-010, A-072): situations with answers
// in Vietnamese and English, managed by managers and copied by consultants.

const AUDITED_FIELDS = ["situationVi", "situationEn", "answerVi", "answerEn", "active"] as const;

/**
 * Everyone who can see leads reads the active scripts that have an answer; managers
 * (`script.manage`) can also list every script, the inactive and the empty ones.
 */
export async function listScripts(actor: Actor, rawQuery: unknown): Promise<ConsultingScript[]> {
  assertCan(actor, "lead.view");
  const { includeInactive } = parseInput(listScriptsQuerySchema, rawQuery);
  if (includeInactive) {
    assertCan(actor, "script.manage");
    return repo.listScripts(prisma, {});
  }
  return repo.listScripts(prisma, {
    active: true,
    ...(actor.permissions.has("script.manage")
      ? {}
      : { OR: [{ answerVi: { not: null } }, { answerEn: { not: null } }] }),
  });
}

export async function createScript(actor: Actor, rawInput: unknown): Promise<ConsultingScript> {
  assertCan(actor, "script.manage");
  const data = parseInput(scriptInputSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const script = await repo.createScript(tx, { ...data, sortOrder: (await repo.lastSortOrder(tx)) + 1 });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "consulting_script",
      entityId: script.id,
      action: "consulting_script.created",
      after: script,
    });
    return script;
  });
}

/** All fields are sent. Scripts are never deleted, only made inactive (A-072). */
export async function updateScript(actor: Actor, id: string, rawInput: unknown): Promise<ConsultingScript> {
  assertCan(actor, "script.manage");
  const data = parseInput(scriptInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const before = await repo.findScript(tx, id);
    if (!before) throw new AppError("NOT_FOUND");
    const after = await repo.updateScript(tx, id, data);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "consulting_script",
        entityId: id,
        action: "consulting_script.updated",
        ...changes,
      });
    }
    return after;
  });
}

/** The whole library in its new order; answers the whole list. */
export async function reorderScripts(actor: Actor, rawInput: unknown): Promise<ConsultingScript[]> {
  assertCan(actor, "script.manage");
  const { scriptIds } = parseInput(scriptOrderSchema, rawInput);
  await prisma.$transaction(async (tx) => {
    const scripts = await repo.listScripts(tx, {});
    const sameSet =
      scriptIds.length === scripts.length &&
      new Set(scriptIds).size === scripts.length &&
      scripts.every((script) => scriptIds.includes(script.id));
    if (!sameSet) throw new AppError("VALIDATION_FAILED", { fieldErrors: { scriptIds: ["invalidChoice"] } });
    for (const [index, id] of scriptIds.entries()) {
      const from = scripts.find((script) => script.id === id)!.sortOrder;
      if (from === index + 1) continue;
      await repo.updateScript(tx, id, { sortOrder: index + 1 });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "consulting_script",
        entityId: id,
        action: "consulting_script.reordered",
        before: { sortOrder: from },
        after: { sortOrder: index + 1 },
      });
    }
  });
  return repo.listScripts(prisma, {});
}
