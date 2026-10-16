import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";

// The workout catalogs (M7.1, brief §7.1): equipment, a tree of body areas, exercises, and plan stages. Entries are
// never deleted, only made inactive (plans keep pointing at them).

/** One transaction at a time changes the area tree, so two moves at once cannot make a loop. */
export async function lockAreaTree(db: Db): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workout_areas'))`;
}

// ------------------------------------------------------------------------------------------------ equipment

export function listEquipment(db: Db, includeInactive: boolean) {
  return db.workoutEquipment.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { _count: { select: { exercises: true } } },
  });
}
export type EquipmentRecord = Awaited<ReturnType<typeof listEquipment>>[number];

export function findEquipment(db: Db, id: string) {
  return db.workoutEquipment.findUnique({ where: { id }, include: { _count: { select: { exercises: true } } } });
}

/** An entry with this code or name, whatever the capitals, other than `exceptId`. */
export function equipmentClash(db: Db, input: { code: string; name: string }, exceptId?: string) {
  return db.workoutEquipment.findFirst({
    where: {
      id: exceptId ? { not: exceptId } : undefined,
      OR: [{ code: input.code }, { name: { equals: input.name, mode: "insensitive" } }],
    },
    select: { code: true, name: true },
  });
}

export function createEquipment(db: Db, data: Prisma.WorkoutEquipmentCreateInput) {
  return db.workoutEquipment.create({ data, include: { _count: { select: { exercises: true } } } });
}

export function updateEquipment(db: Db, id: string, data: Prisma.WorkoutEquipmentUpdateInput) {
  return db.workoutEquipment.update({ where: { id }, data, include: { _count: { select: { exercises: true } } } });
}

// ------------------------------------------------------------------------------------------------------ areas

export function listAreas(db: Db) {
  return db.workoutArea.findMany({ include: { _count: { select: { exercises: true } } } });
}
export type AreaRecord = Awaited<ReturnType<typeof listAreas>>[number];

export function findArea(db: Db, id: string) {
  return db.workoutArea.findUnique({ where: { id }, include: { _count: { select: { exercises: true } } } });
}

/** An area with this code anywhere, or this name among the same parent's children, other than `exceptId`. */
export function areaClash(db: Db, input: { code: string; name: string; parentId: string | null }, exceptId?: string) {
  return db.workoutArea.findFirst({
    where: {
      id: exceptId ? { not: exceptId } : undefined,
      OR: [{ code: input.code }, { parentId: input.parentId, name: { equals: input.name, mode: "insensitive" } }],
    },
    select: { code: true, name: true },
  });
}

export function createArea(db: Db, data: Prisma.WorkoutAreaUncheckedCreateInput) {
  return db.workoutArea.create({ data, include: { _count: { select: { exercises: true } } } });
}

export function updateArea(db: Db, id: string, data: Prisma.WorkoutAreaUncheckedUpdateInput) {
  return db.workoutArea.update({ where: { id }, data, include: { _count: { select: { exercises: true } } } });
}

// -------------------------------------------------------------------------------------------------- exercises

const exerciseInclude = {
  area: { select: { id: true, code: true, name: true } },
  equipment: { select: { id: true, code: true, name: true } },
} satisfies Prisma.WorkoutExerciseInclude;
export type ExerciseRecord = Prisma.WorkoutExerciseGetPayload<{ include: typeof exerciseInclude }>;

export async function listExercises(
  db: Db,
  where: Prisma.WorkoutExerciseWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: ExerciseRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.workoutExercise.findMany({
      where,
      include: exerciseInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.workoutExercise.count({ where }),
  ]);
  return { items, total };
}

export function findExercise(db: Db, id: string) {
  return db.workoutExercise.findUnique({ where: { id }, include: exerciseInclude });
}

export function exerciseNameClash(db: Db, name: string, exceptId?: string) {
  return db.workoutExercise.findFirst({
    where: { id: exceptId ? { not: exceptId } : undefined, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
}

export function createExercise(db: Db, data: Prisma.WorkoutExerciseUncheckedCreateInput) {
  return db.workoutExercise.create({ data, include: exerciseInclude });
}

export function updateExercise(db: Db, id: string, data: Prisma.WorkoutExerciseUncheckedUpdateInput) {
  return db.workoutExercise.update({ where: { id }, data, include: exerciseInclude });
}

// ----------------------------------------------------------------------------------------------------- stages

export function listStages(db: Db, includeInactive: boolean) {
  return db.workoutStage.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export function findStage(db: Db, id: string) {
  return db.workoutStage.findUnique({ where: { id } });
}

export function stageNameClash(db: Db, name: string, exceptId?: string) {
  return db.workoutStage.findFirst({
    where: { id: exceptId ? { not: exceptId } : undefined, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
}

export function createStage(db: Db, data: Prisma.WorkoutStageCreateInput) {
  return db.workoutStage.create({ data });
}

export function updateStage(db: Db, id: string, data: Prisma.WorkoutStageUpdateInput) {
  return db.workoutStage.update({ where: { id }, data });
}
