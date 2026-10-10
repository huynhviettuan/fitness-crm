import type { Db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatTrainerCode, type TrainerData } from "@/modules/trainers/trainer.schema";

const withUser = {
  user: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.TrainerInclude;

export type TrainerRecord = Prisma.TrainerGetPayload<{ include: typeof withUser }>;

/** Draws the next code from the sequence; concurrent callers never get the same value. */
export async function nextTrainerCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('trainer_code_seq') AS value`;
  return formatTrainerCode(row.value);
}

export function createTrainer(db: Db, trainerCode: string, data: TrainerData): Promise<TrainerRecord> {
  return db.trainer.create({ data: { ...data, trainerCode }, include: withUser });
}

export function updateTrainer(db: Db, id: string, data: TrainerData): Promise<TrainerRecord> {
  return db.trainer.update({ where: { id }, data, include: withUser });
}

export function findTrainer(db: Db, id: string): Promise<TrainerRecord | null> {
  return db.trainer.findUnique({ where: { id }, include: withUser });
}

export function findTrainerByUserId(db: Db, userId: string) {
  return db.trainer.findUnique({ where: { userId }, select: { id: true } });
}

export function listTrainers(db: Db, where: Prisma.TrainerWhereInput): Promise<TrainerRecord[]> {
  return db.trainer.findMany({ where, include: withUser, orderBy: [{ status: "asc" }, { fullName: "asc" }] });
}

/** Users with the TRAINER role, and the trainer record each is linked to, if any. */
export function listTrainerLogins(db: Db) {
  return db.user.findMany({
    where: { role: "TRAINER" },
    select: { id: true, name: true, email: true, status: true, trainer: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
}

export function findUserRole(db: Db, userId: string) {
  return db.user.findUnique({ where: { id: userId }, select: { role: true } });
}
