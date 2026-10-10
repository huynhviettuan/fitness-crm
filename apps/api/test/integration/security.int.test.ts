// OWASP A09:2025 Security Logging & Alerting, A05/A10 input handling at the service layer.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { auth } from "../../src/platform/auth/auth.js";
import { createCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import { createUser, setUserStatus } from "../../src/modules/users/user.service.js";
import { resetDatabase } from "../support/database.js";
import { TEST_PASSWORD, createTestUser } from "../support/factories.js";

type LogLine = Record<string, unknown>;

let warn: MockInstance<typeof console.warn>;
let info: MockInstance<typeof console.info>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn");
  info = vi.spyOn(console, "info");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

/** Security events written to the console during the test, parsed. */
function securityEvents(): LogLine[] {
  return [...warn.mock.calls, ...info.mock.calls]
    .map(([line]) => {
      try {
        return JSON.parse(String(line)) as LogLine;
      } catch {
        return null;
      }
    })
    .filter((line): line is LogLine => line?.type === "security");
}

function rawLog(): string {
  return [...warn.mock.calls, ...info.mock.calls].map((args) => args.join(" ")).join("\n");
}

describe("A09 security events are logged", () => {
  it("a permission denial records who, which role, and what was attempted", async () => {
    const { actor } = await createTestUser("TRAINER");

    await expect(createCustomer(actor, { fullName: "X", phone: "0909000000" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(securityEvents()).toContainEqual(
      expect.objectContaining({ event: "authz.denied", userId: actor.id, role: "TRAINER", permission: "customer.manage" }),
    );
  });

  it("a failed sign-in is logged with the email but never the password", async () => {
    const { user } = await createTestUser("RECEPTIONIST");
    const wrongPassword = "Wrong-password-987";

    await expect(auth.api.signInEmail({ body: { email: user.email, password: wrongPassword } })).rejects.toThrow();

    expect(securityEvents()).toContainEqual(expect.objectContaining({ event: "auth.sign_in.failed", email: user.email }));
    expect(rawLog()).not.toContain(wrongPassword);
  });

  it("a sign-in attempt by a disabled user is logged as failed", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("ACCOUNTANT");
    await setUserStatus(admin, { userId: user.id, status: "DISABLED" });

    await expect(auth.api.signInEmail({ body: { email: user.email, password: TEST_PASSWORD } })).rejects.toThrow();

    expect(securityEvents()).toContainEqual(expect.objectContaining({ event: "auth.sign_in.failed", email: user.email }));
  });

  it("a successful sign-in is logged without the password", async () => {
    const { user } = await createTestUser("MANAGER");

    await auth.api.signInEmail({ body: { email: user.email, password: TEST_PASSWORD } });

    expect(securityEvents()).toContainEqual(expect.objectContaining({ event: "auth.sign_in.succeeded", userId: user.id }));
    expect(rawLog()).not.toContain(TEST_PASSWORD);
  });

  it("creating a user never logs or audits the initial password", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const password = "Initial-secret-456";

    await createUser(admin, { name: "Log Test", email: "log-test@fitness-crm.test", role: "TRAINER", password });

    expect(rawLog()).not.toContain(password);
  });
});

describe("A05/A10 control characters are rejected before reaching the database", () => {
  it.each([
    ["NUL", "Nul\u0000byte"],
    ["bell", "Bell\u0007char"],
    ["escape", "Esc\u001b[31mred"],
  ])("a %s character in a name is VALIDATION_FAILED, not a database error", async (_label, fullName) => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(createCustomer(actor, { fullName, phone: "0909000000" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { fullName: ["invalidCharacters"] },
    });
  });

  it("line breaks and tabs in notes are still allowed", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    const customer = await createCustomer(actor, { fullName: "An", phone: "0909000000", notes: "Line 1\nLine 2\tTabbed" });

    expect(customer.notes).toBe("Line 1\nLine 2\tTabbed");
  });

  it("a NUL character in a search is VALIDATION_FAILED", async () => {
    const { actor } = await createTestUser("RECEPTIONIST");

    await expect(listCustomers(actor, { q: "a\u0000b" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
