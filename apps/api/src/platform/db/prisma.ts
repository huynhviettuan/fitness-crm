import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client.js";
import { env } from "../env.js";

// One client per API process, with a small pool (docs/15).
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_SIZE }),
});

/** A Prisma client or an open transaction. Repositories accept either. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * For transactions that take row locks (docs/22 §7): wait for a pooled connection a
 * little longer than the default, and fail rather than hold locks indefinitely.
 */
export const LOCKING_TRANSACTION = { maxWait: 5_000, timeout: 10_000 } as const;
