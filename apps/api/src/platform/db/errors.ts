import { Prisma } from "../../generated/prisma/client.js";

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
  return exclusionCause(error) !== null;
}

/** The name of the exclusion constraint a write violated, when the driver reports it. */
export function violatedConstraint(error: unknown): string | undefined {
  const cause = exclusionCause(error);
  const text = `${cause?.message ?? ""} ${cause?.originalMessage ?? ""} ${cause?.constraint ?? ""}`;
  return /\b[a-z_]+_no_overlap\b/.exec(text)?.[0];
}

type DriverCause = { code?: unknown; message?: string; originalMessage?: string; constraint?: string };

function exclusionCause(error: unknown): DriverCause | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const cause = (error.meta?.driverAdapterError as { cause?: DriverCause } | undefined)?.cause;
  return cause?.code === "23P01" ? cause : null;
}
