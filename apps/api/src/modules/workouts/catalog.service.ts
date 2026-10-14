import { z } from "zod";
import {
  MAX_AREA_DEPTH,
  areaInputSchema,
  areaPath,
  catalogQuerySchema,
  depthOf,
  descendantIds,
  equipmentInputSchema,
  exerciseInputSchema,
  exerciseListQuerySchema,
  heightOf,
  stageInputSchema,
  wouldCycle,
  type Area,
  type Equipment,
  type Exercise,
  type ExercisePage,
  type Stage,
} from "@flow/shared/workouts";
import { normalizeForSearch } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { AppError } from "../../platform/errors/app-error.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as repo from "./catalog.repository.js";

// The workout catalogs (M7.1, brief §7.1, FR-WKO-001, D-033; A-188 to A-191). Anyone who plans or reviews training reads
// them (`workout.view`); the managers keep them (`workout.catalog`). Nothing is deleted, only made inactive; every
// change is audited with its values before and after (T-048).

const uuid = z.uuid();
const notFound = () => new AppError("NOT_FOUND");
const clash = (field: string) => new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: ["duplicate"] } });
const invalid = (field: string, code = "invalidChoice") =>
  new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: [code] } });

/** A clash the pre-check missed because two requests raced: the database's unique index says the same. */
async function guarded<T>(work: () => Promise<T>, field: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw clash(field);
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------ equipment

function equipmentView(row: repo.EquipmentRecord): Equipment {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    notes: row.notes,
    active: row.active,
    exercises: row._count.exercises,
    updatedAt: row.updatedAt,
  };
}

const equipmentAudit = (row: { code: string; name: string; notes: string | null; active: boolean }) => ({
  code: row.code,
  name: row.name,
  notes: row.notes,
  active: row.active,
});

export async function listEquipment(actor: Actor, rawQuery: unknown): Promise<{ items: Equipment[] }> {
  assertCan(actor, "workout.view");
  const { includeInactive } = parseInput(catalogQuerySchema, rawQuery);
  return { items: (await repo.listEquipment(prisma, includeInactive)).map(equipmentView) };
}

export async function createEquipment(actor: Actor, rawInput: unknown): Promise<Equipment> {
  assertCan(actor, "workout.catalog");
  const data = parseInput(equipmentInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        const other = await repo.equipmentClash(tx, data);
        if (other) throw clash(other.code === data.code ? "code" : "name");
        const row = await repo.createEquipment(tx, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_equipment",
          entityId: row.id,
          action: "workout_equipment.created",
          after: equipmentAudit(row),
        });
        return equipmentView(row);
      }),
    "code",
  );
}

export async function updateEquipment(actor: Actor, id: string, rawInput: unknown): Promise<Equipment> {
  assertCan(actor, "workout.catalog");
  if (!uuid.safeParse(id).success) throw notFound();
  const data = parseInput(equipmentInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        const before = await repo.findEquipment(tx, id);
        if (!before) throw notFound();
        const other = await repo.equipmentClash(tx, data, id);
        if (other) throw clash(other.code === data.code ? "code" : "name");
        const row = await repo.updateEquipment(tx, id, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_equipment",
          entityId: id,
          action: "workout_equipment.updated",
          before: equipmentAudit(before),
          after: equipmentAudit(row),
        });
        return equipmentView(row);
      }),
    "code",
  );
}

// ------------------------------------------------------------------------------------------------------ areas

function areaViews(rows: repo.AreaRecord[]): Area[] {
  const nodes = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
  const view = (row: repo.AreaRecord): Area => ({
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    path: areaPath(nodes, row.id),
    depth: depthOf(nodes, row.id),
    notes: row.notes,
    active: row.active,
    exercises: row._count.exercises,
    updatedAt: row.updatedAt,
  });
  // Reading order: each area is followed by what is below it, siblings by name.
  const ordered: repo.AreaRecord[] = [];
  const below = (parentId: string | null) => {
    rows
      .filter((row) => row.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .forEach((row) => {
        ordered.push(row);
        below(row.id);
      });
  };
  below(null);
  return ordered.map(view);
}

const areaAudit = (row: {
  code: string;
  name: string;
  parentId: string | null;
  notes: string | null;
  active: boolean;
}) => ({
  code: row.code,
  name: row.name,
  parentId: row.parentId,
  notes: row.notes,
  active: row.active,
});

export async function listAreas(actor: Actor, rawQuery: unknown): Promise<{ items: Area[] }> {
  assertCan(actor, "workout.view");
  const { includeInactive } = parseInput(catalogQuerySchema, rawQuery);
  const views = areaViews(await repo.listAreas(prisma));
  return { items: includeInactive ? views : views.filter((area) => area.active) };
}

/** The new parent must exist, must not be the area or below it, and the tree must stay within its depth. */
async function checkParent(tx: Db, id: string | null, parentId: string | null): Promise<void> {
  if (parentId === null) return;
  const all = await repo.listAreas(tx);
  const nodes = all.map((row) => ({ id: row.id, parentId: row.parentId }));
  if (!nodes.some((node) => node.id === parentId)) throw invalid("parentId");
  if (id !== null && wouldCycle(nodes, id, parentId)) throw invalid("parentId", "cycle");
  const below = id === null ? 0 : heightOf(nodes, id);
  if (depthOf(nodes, parentId) + 1 + below > MAX_AREA_DEPTH) throw invalid("parentId", "tooDeep");
}

export async function createArea(actor: Actor, rawInput: unknown): Promise<Area> {
  assertCan(actor, "workout.catalog");
  const data = parseInput(areaInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        await repo.lockAreaTree(tx);
        await checkParent(tx, null, data.parentId);
        const other = await repo.areaClash(tx, data);
        if (other) throw clash(other.code === data.code ? "code" : "name");
        const row = await repo.createArea(tx, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_area",
          entityId: row.id,
          action: "workout_area.created",
          after: areaAudit(row),
        });
        return areaViews(await repo.listAreas(tx)).find((area) => area.id === row.id)!;
      }),
    "code",
  );
}

export async function updateArea(actor: Actor, id: string, rawInput: unknown): Promise<Area> {
  assertCan(actor, "workout.catalog");
  if (!uuid.safeParse(id).success) throw notFound();
  const data = parseInput(areaInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        await repo.lockAreaTree(tx);
        const before = await repo.findArea(tx, id);
        if (!before) throw notFound();
        await checkParent(tx, id, data.parentId);
        const other = await repo.areaClash(tx, data, id);
        if (other) throw clash(other.code === data.code ? "code" : "name");
        const row = await repo.updateArea(tx, id, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_area",
          entityId: id,
          action: "workout_area.updated",
          before: areaAudit(before),
          after: areaAudit(row),
        });
        return areaViews(await repo.listAreas(tx)).find((area) => area.id === id)!;
      }),
    "code",
  );
}

// -------------------------------------------------------------------------------------------------- exercises

function exerciseView(
  row: repo.ExerciseRecord,
  areas: { id: string; parentId: string | null; name: string }[],
): Exercise {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    area: { ...row.area, path: areaPath(areas, row.area.id) },
    equipment: row.equipment,
    description: row.description,
    videoUrl: row.videoUrl,
    active: row.active,
    updatedAt: row.updatedAt,
  };
}

const exerciseAudit = (row: {
  name: string;
  kind: string;
  areaId: string;
  equipmentId: string | null;
  description: string | null;
  videoUrl: string | null;
  active: boolean;
}) => ({
  name: row.name,
  kind: row.kind,
  areaId: row.areaId,
  equipmentId: row.equipmentId,
  description: row.description,
  videoUrl: row.videoUrl,
  active: row.active,
});

async function areaNodes(db: Db) {
  return (await repo.listAreas(db)).map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
}

export async function listExercises(actor: Actor, rawQuery: unknown): Promise<ExercisePage> {
  assertCan(actor, "workout.view");
  const query = parseInput(exerciseListQuerySchema, rawQuery);
  const areas = await areaNodes(prisma);
  const search = normalizeForSearch(query.q);
  const where: Prisma.WorkoutExerciseWhereInput = {
    active: query.includeInactive ? undefined : true,
    // An area stands for itself and everything below it.
    areaId: query.areaId ? { in: [query.areaId, ...descendantIds(areas, query.areaId)] } : undefined,
    equipmentId: query.equipmentId,
    kind: query.kind,
    searchName: search ? { contains: search } : undefined,
  };
  const { items, total } = await repo.listExercises(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    items: items.map((item) => exerciseView(item, areas)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getExercise(actor: Actor, id: string): Promise<Exercise> {
  assertCan(actor, "workout.view");
  if (!uuid.safeParse(id).success) throw notFound();
  const row = await repo.findExercise(prisma, id);
  if (!row) throw notFound();
  return exerciseView(row, await areaNodes(prisma));
}

/** The area and the equipment must exist; an exercise is never put under an area or equipment that was made inactive. */
async function checkReferences(
  tx: Db,
  data: { areaId: string; equipmentId: string | null },
  before?: { areaId: string; equipmentId: string | null },
): Promise<void> {
  const area = await repo.findArea(tx, data.areaId);
  if (!area || (!area.active && data.areaId !== before?.areaId)) throw invalid("areaId");
  if (data.equipmentId) {
    const equipment = await repo.findEquipment(tx, data.equipmentId);
    if (!equipment || (!equipment.active && data.equipmentId !== before?.equipmentId)) throw invalid("equipmentId");
  }
}

export async function createExercise(actor: Actor, rawInput: unknown): Promise<Exercise> {
  assertCan(actor, "workout.catalog");
  const data = parseInput(exerciseInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        await checkReferences(tx, data);
        if (await repo.exerciseNameClash(tx, data.name)) throw clash("name");
        const row = await repo.createExercise(tx, { ...data, searchName: normalizeForSearch(data.name) });
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_exercise",
          entityId: row.id,
          action: "workout_exercise.created",
          after: exerciseAudit(row),
        });
        return exerciseView(row, await areaNodes(tx));
      }),
    "name",
  );
}

export async function updateExercise(actor: Actor, id: string, rawInput: unknown): Promise<Exercise> {
  assertCan(actor, "workout.catalog");
  if (!uuid.safeParse(id).success) throw notFound();
  const data = parseInput(exerciseInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        const before = await repo.findExercise(tx, id);
        if (!before) throw notFound();
        await checkReferences(tx, data, before);
        if (await repo.exerciseNameClash(tx, data.name, id)) throw clash("name");
        const row = await repo.updateExercise(tx, id, { ...data, searchName: normalizeForSearch(data.name) });
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_exercise",
          entityId: id,
          action: "workout_exercise.updated",
          before: exerciseAudit(before),
          after: exerciseAudit(row),
        });
        return exerciseView(row, await areaNodes(tx));
      }),
    "name",
  );
}

// ----------------------------------------------------------------------------------------------------- stages

const stageView = (row: {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  updatedAt: Date;
}): Stage => ({
  id: row.id,
  name: row.name,
  description: row.description,
  active: row.active,
  updatedAt: row.updatedAt,
});

const stageAudit = (row: { name: string; description: string | null; active: boolean }) => ({
  name: row.name,
  description: row.description,
  active: row.active,
});

export async function listStages(actor: Actor, rawQuery: unknown): Promise<{ items: Stage[] }> {
  assertCan(actor, "workout.view");
  const { includeInactive } = parseInput(catalogQuerySchema, rawQuery);
  return { items: (await repo.listStages(prisma, includeInactive)).map(stageView) };
}

export async function createStage(actor: Actor, rawInput: unknown): Promise<Stage> {
  assertCan(actor, "workout.catalog");
  const data = parseInput(stageInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        if (await repo.stageNameClash(tx, data.name)) throw clash("name");
        const row = await repo.createStage(tx, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_stage",
          entityId: row.id,
          action: "workout_stage.created",
          after: stageAudit(row),
        });
        return stageView(row);
      }),
    "name",
  );
}

export async function updateStage(actor: Actor, id: string, rawInput: unknown): Promise<Stage> {
  assertCan(actor, "workout.catalog");
  if (!uuid.safeParse(id).success) throw notFound();
  const data = parseInput(stageInputSchema, rawInput);
  return guarded(
    () =>
      prisma.$transaction(async (tx) => {
        const before = await repo.findStage(tx, id);
        if (!before) throw notFound();
        if (await repo.stageNameClash(tx, data.name, id)) throw clash("name");
        const row = await repo.updateStage(tx, id, data);
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "workout_stage",
          entityId: id,
          action: "workout_stage.updated",
          before: stageAudit(before),
          after: stageAudit(row),
        });
        return stageView(row);
      }),
    "name",
  );
}
