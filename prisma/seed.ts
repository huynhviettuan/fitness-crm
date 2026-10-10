// Creates the first admin account so someone can sign in and create other users.
// Run with: npm run db:seed. Safe to run more than once.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { recordAudit } from "../src/modules/audit/audit.repository";
import { createUserWithPassword, findUserByEmail } from "../src/modules/users/user.repository";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Admin";
  if (!email || !password) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed the first admin.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    if (await findUserByEmail(prisma, email)) {
      console.log(`Admin ${email} already exists; nothing to do.`);
      return;
    }
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await createUserWithPassword(tx, { name, email, role: "ADMIN" }, passwordHash);
      await recordAudit(tx, {
        actorUserId: null,
        entityType: "user",
        entityId: user.id,
        action: "user.created",
        metadata: { email, role: "ADMIN", source: "seed" },
      });
    });
    console.log(`Created admin ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
