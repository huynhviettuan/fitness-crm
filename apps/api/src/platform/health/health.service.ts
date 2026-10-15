import type { Health, Liveness } from "@flow/shared/health";
import { prisma } from "../db/prisma.js";

// M9.4 (A-311): the platform's health check and the uptime monitor call this every few seconds, so it only asks the
// database for one row, and gives up after a short wait rather than piling up behind a stuck pool.
const DATABASE_WAIT_MS = 3_000;

/** The process is up and answering (A-315); nothing else is asked. */
export function checkLiveness(): Liveness {
  return { status: "ok", time: new Date() };
}

export async function checkHealth(ping: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`): Promise<Health> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database did not answer in time")), DATABASE_WAIT_MS);
  });
  const database = await Promise.race([ping(), late])
    .then(() => "ok" as const)
    .catch(() => "unavailable" as const)
    .finally(() => clearTimeout(timer));
  return { status: database, database, time: new Date() };
}
