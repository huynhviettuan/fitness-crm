import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// One client per server instance. In development, reuse it across hot reloads so
// connections are not leaked. Keep the pool small: on Vercel every instance has its
// own pool, and DATABASE_URL should point at the provider's pooled endpoint (docs/15).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 5 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** A Prisma client or an open transaction. Repositories accept either. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * For transactions that take row locks (docs/22 §7): wait for a pooled connection a
 * little longer than the default, and fail rather than hold locks indefinitely.
 */
export const LOCKING_TRANSACTION = { maxWait: 5_000, timeout: 10_000 } as const;
