import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { clientIp, logSecurityEvent } from "@/lib/security/log";

// Better Auth (T-028). Users are created by an admin through the user service, never
// by self sign-up. Routes are served at /api/auth/* (T-016).
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
  },
  // Endpoints this app does not offer. Profile, email and account changes go through
  // the audited user service instead.
  disabledPaths: [
    "/sign-up/email",
    "/update-user",
    "/delete-user",
    "/change-email",
    "/request-password-reset",
    "/reset-password",
    "/send-verification-email",
    "/verify-email",
  ],
  user: {
    additionalFields: {
      role: { type: "string", input: false, required: false },
      status: { type: "string", input: false, required: false },
      locale: { type: "string", input: false, required: false },
    },
  },
  session: {
    modelName: "authSession",
    // Reception PCs are shared: a session lasts one working day without activity.
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
  account: { modelName: "authAccount" },
  verification: { modelName: "authVerification" },
  rateLimit: {
    // On in development too (Better Auth enables it only in production by default), so
    // E2E tests prove it. Integration tests call the API in-process without a request.
    enabled: process.env.NODE_ENV !== "test",
    storage: "database",
    modelName: "authRateLimit",
    // Limits are per IP address, and every PC at the gym shares one public IP, so the
    // limit must allow a whole shift signing in at once while still slowing guessing.
    customRules: {
      "/sign-in/email": { window: 60, max: 20 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  hooks: {
    // Every sign-in attempt is logged (OWASP A09). The password is never logged.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const ip = ctx.request ? clientIp(ctx.request.headers) : null;
      const returned = ctx.context.returned;
      if (isAPIError(returned)) {
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : null;
        logSecurityEvent("auth.sign_in.failed", { email, ip, status: returned.statusCode });
      } else if (ctx.context.newSession) {
        logSecurityEvent("auth.sign_in.succeeded", { userId: ctx.context.newSession.user.id, ip }, "info");
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // A disabled account cannot sign in (T-017).
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          return user?.status === "ACTIVE";
        },
      },
    },
  },
  // Must be the last plugin.
  plugins: [nextCookies()],
});
