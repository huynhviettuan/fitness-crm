import { instantAt } from "@flow/shared/validation";
import { env } from "../env.js";

const DAY_MS = 86_400_000;

/**
 * The instants of whole gym days, `from` and `to` inclusive (A-001), as a Prisma range.
 * Either bound may be missing.
 */
export function gymDaysRange(from: Date | undefined, to: Date | undefined): { gte?: Date; lt?: Date } {
  return {
    gte: from ? instantAt(from, "00:00", env.GYM_TIMEZONE) : undefined,
    lt: to ? instantAt(new Date(to.getTime() + DAY_MS), "00:00", env.GYM_TIMEZONE) : undefined,
  };
}
