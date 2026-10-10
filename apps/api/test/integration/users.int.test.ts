import { afterEach, describe, expect, it } from "vitest";
import { auth } from "../../src/platform/auth/auth.js";
import { getSessionUser } from "../../src/platform/auth/session.js";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  changeUserRole,
  createUser,
  resetUserPassword,
  setOwnLocale,
  setUserStatus,
} from "../../src/modules/users/user.service.js";
import { resetDatabase } from "../support/database.js";
import { TEST_PASSWORD, createTestUser } from "../support/factories.js";

afterEach(resetDatabase);

/** Signs in through Better Auth and returns request headers carrying the session cookie. */
async function signIn(email: string, password: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

const newUser = { name: "Lê Lễ Tân", email: "Le.Tan@Fitness-CRM.test", role: "RECEPTIONIST", password: "Initial-pass-1" };

describe("createUser", () => {
  it("creates a user who can sign in, and audits it without the password", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const user = await createUser(admin, newUser);

    expect(user).toMatchObject({ email: "le.tan@fitness-crm.test", role: "RECEPTIONIST", status: "ACTIVE", locale: "vi" });
    const session = await getSessionUser(await signIn(user.email, newUser.password));
    expect(session).toMatchObject({ id: user.id, role: "RECEPTIONIST" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: user.id } });
    expect(audit.action).toBe("user.created");
    expect(JSON.stringify(audit.metadata)).not.toContain(newUser.password);
  });

  it("rejects an email that is already used, even when two admins submit at once", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const results = await Promise.allSettled([createUser(admin, newUser), createUser(admin, newUser)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "EMAIL_ALREADY_USED", fieldErrors: { email: ["emailAlreadyUsed"] } },
    });
  });

  it.each(["MANAGER", "RECEPTIONIST", "TRAINER", "ACCOUNTANT"] as const)("rejects a %s (docs/09)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createUser(actor, newUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires a password of at least 10 characters", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    await expect(createUser(admin, { ...newUser, password: "short" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { password: ["passwordTooShort"] },
    });
  });
});

describe("disabling a user (T-017, INT-006)", () => {
  it("rejects their existing session on the next request and blocks new sign-ins", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");
    const headers = await signIn(user.email, TEST_PASSWORD);
    expect(await getSessionUser(headers)).not.toBeNull();

    await setUserStatus(admin, { userId: user.id, status: "DISABLED" });

    expect(await getSessionUser(headers)).toBeNull();
    await expect(signIn(user.email, TEST_PASSWORD)).rejects.toThrow();
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it("lets them sign in again once enabled", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("TRAINER");
    await setUserStatus(admin, { userId: user.id, status: "DISABLED" });

    await setUserStatus(admin, { userId: user.id, status: "ACTIVE" });

    expect(await getSessionUser(await signIn(user.email, TEST_PASSWORD))).toMatchObject({ id: user.id });
    const actions = await prisma.auditEvent.findMany({ where: { entityId: user.id }, orderBy: { createdAt: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["user.disabled", "user.enabled"]);
  });

  it("an admin cannot disable or demote themselves", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    await expect(setUserStatus(admin, { userId: admin.id, status: "DISABLED" })).rejects.toMatchObject({
      code: "CANNOT_CHANGE_OWN_ACCESS",
    });
    await expect(changeUserRole(admin, { userId: admin.id, role: "TRAINER" })).rejects.toMatchObject({
      code: "CANNOT_CHANGE_OWN_ACCESS",
    });
  });
});

describe("roles and passwords", () => {
  it("a role change applies to the user's very next request", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");
    const headers = await signIn(user.email, TEST_PASSWORD);

    await changeUserRole(admin, { userId: user.id, role: "MANAGER" });

    expect(await getSessionUser(headers)).toMatchObject({ role: "MANAGER" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.role_changed" } });
    expect(audit.metadata).toEqual({ changes: { role: { from: "RECEPTIONIST", to: "MANAGER" } } });
  });

  it("a password reset signs the user out and only the new password works", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("ACCOUNTANT");
    const oldSession = await signIn(user.email, TEST_PASSWORD);

    await resetUserPassword(admin, { userId: user.id, password: "Brand-new-pass-1" });

    expect(await getSessionUser(oldSession)).toBeNull();
    await expect(signIn(user.email, TEST_PASSWORD)).rejects.toThrow();
    expect(await getSessionUser(await signIn(user.email, "Brand-new-pass-1"))).toMatchObject({ id: user.id });
  });

  it("any user can change their own UI language", async () => {
    const { actor, user } = await createTestUser("TRAINER");

    await setOwnLocale(actor, { locale: "en" });

    expect(await getSessionUser(await signIn(user.email, TEST_PASSWORD))).toMatchObject({ locale: "en" });
  });
});
