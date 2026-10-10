import { Prisma } from "@/generated/prisma/client";

/** True when a write failed because it violated a unique constraint (Prisma P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * True when a write violated an exclusion constraint (SQLSTATE 23P01), such as the
 * trainer-overlap constraint (T-014). Prisma has no code of its own for it; the
 * PostgreSQL code arrives in the driver adapter error.
 */
export function isExclusionViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const cause = (error.meta?.driverAdapterError as { cause?: { code?: unknown } } | undefined)?.cause;
  return cause?.code === "23P01";
}
