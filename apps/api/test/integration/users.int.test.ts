import { afterEach, describe, expect, it } from "vitest";
import { TZDate } from "@date-fns/tz";
import { auth } from "../../src/platform/auth/auth.js";
import { getSessionUser } from "../../src/platform/auth/session.js";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  changeUserRole,
  createUser,
  getUser,
  listLoginHistory,
  resetUserPassword,
  setOwnLocale,
  setUserAccessWindows,
  setUserBranches,
  setUserOverrides,
  setUserStatus,
} from "../../src/modules/users/user.service.js";
import { createCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import { resetDatabase } from "../support/database.js";
import { DEFAULT_BRANCH_ID, TEST_PASSWORD, createTestBranch, createTestUser, roleId } from "../support/factories.js";

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

async function newUser() {
  return {
    name: "Lê Lễ Tân",
    email: "Le.Tan@Fitness-CRM.test",
    roleId: await roleId("RECEPTIONIST"),
    branchIds: [DEFAULT_BRANCH_ID],
    password: "Initial-pass-1",
  };
}

describe("createUser", () => {
  it("creates a user who can sign in with the role's permissions, and audits it without the password", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const input = await newUser();

    const user = await createUser(admin, input);

    expect(user).toMatchObject({
      email: "le.tan@fitness-crm.test",
      role: { id: input.roleId, name: "Lễ tân" },
      status: "ACTIVE",
      locale: "vi",
      allBranches: false,
      branches: [{ id: DEFAULT_BRANCH_ID, name: "Chi nhánh chính" }],
    });
    const session = await getSessionUser(await signIn(user.email, input.password));
    expect(session?.id).toBe(user.id);
    expect(session?.permissions.has("customer.manage")).toBe(true);
    expect(session?.permissions.has("contract.create")).toBe(false);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: user.id } });
    expect(audit.action).toBe("user.created");
    expect(JSON.stringify(audit)).not.toContain(input.password);
  });

  it("rejects an email that is already used, even when two admins submit at once", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const input = await newUser();

    const results = await Promise.allSettled([createUser(admin, input), createUser(admin, input)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "EMAIL_ALREADY_USED", fieldErrors: { email: ["emailAlreadyUsed"] } },
    });
  });

  it("needs a known role and at least one branch unless the user has every branch (D-014)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const input = await newUser();

    await expect(createUser(admin, { ...input, roleId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({
      fieldErrors: { roleId: ["invalidChoice"] },
    });
    await expect(createUser(admin, { ...input, branchIds: [] })).rejects.toMatchObject({ fieldErrors: { branchIds: ["required"] } });
    await expect(createUser(admin, { ...input, branchIds: [], allBranches: true })).resolves.toMatchObject({ allBranches: true });
  });

  it.each(["FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT"] as const)("rejects a %s (docs/09)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createUser(actor, await newUser())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires a password of at least 10 characters", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    await expect(createUser(admin, { ...(await newUser()), password: "short" })).rejects.toMatchObject({
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
    const { user } = await createTestUser("PT");
    await setUserStatus(admin, { userId: user.id, status: "DISABLED" });

    await setUserStatus(admin, { userId: user.id, status: "ACTIVE" });

    expect(await getSessionUser(await signIn(user.email, TEST_PASSWORD))).toMatchObject({ id: user.id });
    const actions = await prisma.auditEvent.findMany({ where: { entityId: user.id }, orderBy: { createdAt: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["user.disabled", "user.enabled"]);
  });

  it("an admin cannot disable, demote, or restrict themselves", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const own = { code: "CANNOT_CHANGE_OWN_ACCESS" };

    await expect(setUserStatus(admin, { userId: admin.id, status: "DISABLED" })).rejects.toMatchObject(own);
    await expect(changeUserRole(admin, { userId: admin.id, roleId: await roleId("PT") })).rejects.toMatchObject(own);
    await expect(setUserBranches(admin, { userId: admin.id, branchIds: [DEFAULT_BRANCH_ID] })).rejects.toMatchObject(own);
    await expect(setUserOverrides(admin, { userId: admin.id, overrides: [] })).rejects.toMatchObject(own);
    await expect(setUserAccessWindows(admin, { userId: admin.id, windows: [] })).rejects.toMatchObject(own);
  });
});

describe("roles, overrides, and passwords (D-017)", () => {
  it("a role change applies to the user's very next request", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");
    const headers = await signIn(user.email, TEST_PASSWORD);
    const managerRole = await roleId("FITNESS_MANAGER");

    await changeUserRole(admin, { userId: user.id, roleId: managerRole });

    const session = await getSessionUser(headers);
    expect(session?.role.id).toBe(managerRole);
    expect(session?.permissions.has("contract.approve")).toBe(true);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.role_changed" } });
    expect(audit).toMatchObject({ before: { roleId: await roleId("RECEPTIONIST") }, after: { roleId: managerRole } });
  });

  it("an override switches one permission on or off for one user, on their next request (FR-PLT-003)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");
    const headers = await signIn(user.email, TEST_PASSWORD);

    const detail = await setUserOverrides(admin, {
      userId: user.id,
      overrides: [
        { permission: "contract.create", granted: true },
        { permission: "customer.manage", granted: false },
      ],
    });

    expect(detail.overrides).toEqual([
      { permission: "contract.create", granted: true },
      { permission: "customer.manage", granted: false },
    ]);
    const session = await getSessionUser(headers);
    expect(session?.permissions.has("contract.create")).toBe(true);
    expect(session?.permissions.has("customer.manage")).toBe(false);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "user.overrides_changed" } })).toBe(1);
  });

  it("refuses unknown permissions and duplicates", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");

    await expect(
      setUserOverrides(admin, { userId: user.id, overrides: [{ permission: "everything", granted: true }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const twice = [
      { permission: "contract.create", granted: true },
      { permission: "contract.create", granted: false },
    ];
    await expect(setUserOverrides(admin, { userId: user.id, overrides: twice })).rejects.toMatchObject({
      fieldErrors: { overrides: ["duplicate"] },
    });
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
    const { actor, user } = await createTestUser("PT");

    await setOwnLocale(actor, { locale: "en" });

    expect(await getSessionUser(await signIn(user.email, TEST_PASSWORD))).toMatchObject({ locale: "en" });
  });
});

describe("branch access (D-014)", () => {
  it("a user sees only the records of their branches, and a new grant applies at once", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const other = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("RECEPTIONIST", { branchIds: [other.id] });
    const { user, actor: here } = await createTestUser("RECEPTIONIST");
    await createCustomer(elsewhere, { fullName: "Khách chi nhánh khác", phone: "0909111222" });

    expect((await listCustomers(here, { q: "chi nhanh khac" })).total).toBe(0);
    expect((await listCustomers(admin, { q: "chi nhanh khac" })).total).toBe(1);

    await setUserBranches(admin, { userId: user.id, branchIds: [DEFAULT_BRANCH_ID, other.id] });
    const session = await getSessionUser(await signIn(user.email, TEST_PASSWORD));
    expect((await listCustomers(session!, { q: "chi nhanh khac" })).total).toBe(1);
  });
});

describe("access hours and login history (D-017)", () => {
  /** An ISO weekday that is not today in the gym timezone. */
  function anotherDay(): number {
    const today = new TZDate(new Date(), "Asia/Ho_Chi_Minh").getDay() || 7;
    return (today % 7) + 1;
  }

  it("outside their hours a user cannot sign in, an open session stops working, and both are recorded", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");
    const headers = await signIn(user.email, TEST_PASSWORD);
    const otherDay = anotherDay();

    const detail = await setUserAccessWindows(admin, {
      userId: user.id,
      windows: [{ weekdays: [otherDay], startTime: "00:00", endTime: "23:59" }],
    });

    expect(detail.accessWindows).toEqual([{ weekdays: [otherDay], startTime: "00:00", endTime: "23:59" }]);
    expect(await getSessionUser(headers)).toBeNull();
    await expect(signIn(user.email, TEST_PASSWORD)).rejects.toThrow();

    const history = await listLoginHistory(admin, user.id, {});
    expect(history.items.map((e) => [e.success, e.reason])).toEqual([
      [false, "OUTSIDE_HOURS"],
      [true, null],
    ]);

    await setUserAccessWindows(admin, { userId: user.id, windows: [] });
    expect(await getSessionUser(await signIn(user.email, TEST_PASSWORD))).toMatchObject({ id: user.id });
  });

  it("records a wrong password and an unknown email", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");

    await expect(signIn(user.email, "Wrong-password-1")).rejects.toThrow();
    await expect(signIn("nobody@fitness-crm.test", "Wrong-password-1")).rejects.toThrow();

    expect((await listLoginHistory(admin, user.id, {})).items).toMatchObject([{ success: false, reason: "WRONG_PASSWORD" }]);
    expect(await prisma.loginEvent.findFirst({ where: { email: "nobody@fitness-crm.test" } })).toMatchObject({
      userId: null,
      reason: "UNKNOWN_USER",
    });
  });

  it("refuses windows that end before they start or have no days", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("RECEPTIONIST");

    await expect(
      setUserAccessWindows(admin, { userId: user.id, windows: [{ weekdays: [1], startTime: "18:00", endTime: "08:00" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      setUserAccessWindows(admin, { userId: user.id, windows: [{ weekdays: [], startTime: "08:00", endTime: "18:00" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getUser(admin, user.id)).accessWindows).toEqual([]);
  });
});
