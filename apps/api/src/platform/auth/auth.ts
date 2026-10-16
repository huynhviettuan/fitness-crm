import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { prisma } from "../db/prisma.js";
import { env } from "../env.js";
import { clientIp, logSecurityEvent } from "../security/log.js";
import { isWithinAccessWindows } from "./access-hours.js";

// Better Auth (T-028, T-044). Users are created by an admin through the user service,
// never by self sign-up. Routes are served at /api/auth/* (T-016); browsers reach them
// through the web app (T-053).
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
    enabled: env.NODE_ENV !== "test",
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
    // The web app forwards the browser's address (T-053); rate limits key on it.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  hooks: {
    // Every sign-in attempt is logged (OWASP A09) and kept in the login history (D-017).
    // The password is never logged.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const headers = ctx.request?.headers;
      const ip = headers ? clientIp(headers) : null;
      const userAgent = headers?.get("user-agent")?.slice(0, 500) ?? null;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase().slice(0, 320) : "";
      const returned = ctx.context.returned;
      if (isAPIError(returned)) {
        const user = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
        const reason = user ? ((await failureReason(user.id)) ?? "WRONG_PASSWORD") : "UNKNOWN_USER";
        logSecurityEvent("auth.sign_in.failed", { email, ip, status: returned.statusCode, reason });
        await prisma.loginEvent.create({
          data: { userId: user?.id ?? null, email, success: false, reason, ip, userAgent },
        });
      } else if (ctx.context.newSession) {
        const userId = ctx.context.newSession.user.id;
        logSecurityEvent("auth.sign_in.succeeded", { userId, ip }, "info");
        await prisma.loginEvent.create({ data: { userId, email, success: true, ip, userAgent } });
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // A disabled account, or one outside its allowed hours, cannot sign in (T-017, D-017).
        before: async (session) => (await failureReason(session.userId)) === null,
      },
    },
  },
});

/** Why a known user may not have a session now, or null if they may (then a failed sign-in was a wrong password). */
async function failureReason(userId: string): Promise<"DISABLED" | "OUTSIDE_HOURS" | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, accessWindows: { select: { weekdays: true, startTime: true, endTime: true } } },
  });
  if (!user || user.status !== "ACTIVE") return "DISABLED";
  if (!isWithinAccessWindows(user.accessWindows, new Date(), env.GYM_TIMEZONE)) return "OUTSIDE_HOURS";
  return null;
}
