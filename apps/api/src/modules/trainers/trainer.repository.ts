import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { formatTrainerCode, type TrainerData } from "@flow/shared/trainers";

const withUser = {
  user: { select: { id: true, name: true, email: true } },
  branch: { select: { id: true, name: true } },
} as const satisfies Prisma.TrainerInclude;

export type TrainerWrite = Omit<TrainerData, "branchId"> & { branchId: string };

export type TrainerRecord = Prisma.TrainerGetPayload<{ include: typeof withUser }>;

/** Draws the next code from the sequence; concurrent callers never get the same value. */
export async function nextTrainerCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('trainer_code_seq') AS value`;
  return formatTrainerCode(row.value);
}

export function createTrainer(db: Db, trainerCode: string, data: TrainerWrite): Promise<TrainerRecord> {
  return db.trainer.create({ data: { ...data, trainerCode }, include: withUser });
}

export function updateTrainer(db: Db, id: string, data: TrainerWrite): Promise<TrainerRecord> {
  return db.trainer.update({ where: { id }, data, include: withUser });
}

export function findTrainer(db: Db, id: string, visibility: Prisma.TrainerWhereInput = {}): Promise<TrainerRecord | null> {
  return db.trainer.findFirst({ where: { AND: [{ id }, visibility] }, include: withUser });
}

export function findTrainerByUserId(db: Db, userId: string) {
  return db.trainer.findUnique({ where: { userId }, select: { id: true } });
}

export function listTrainers(db: Db, where: Prisma.TrainerWhereInput): Promise<TrainerRecord[]> {
  return db.trainer.findMany({ where, include: withUser, orderBy: [{ status: "asc" }, { fullName: "asc" }] });
}

/**
 * Logins that can act as a trainer: users whose role sees only its own schedule (the PT
 * role by default), with the trainer record each is linked to, if any (A-010).
 */
const actsAsTrainer = { role: { dataScopes: { some: { resource: "schedule", scope: "OWN" } } } } as const satisfies Prisma.UserWhereInput;

export function listTrainerLogins(db: Db) {
  return db.user.findMany({
    where: actsAsTrainer,
    select: { id: true, name: true, email: true, status: true, trainer: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
}

export async function canActAsTrainer(db: Db, userId: string): Promise<boolean> {
  return (await db.user.count({ where: { id: userId, ...actsAsTrainer } })) === 1;
}
