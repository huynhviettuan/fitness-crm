// OWASP A07:2025 Authentication Failures — session cookie and session lifecycle.
import { expect, test } from "../fixtures";
import { E2E_PASSWORD, E2E_USERS } from "../support/db";

test.describe("A07 sessions", () => {
  test("the session cookie is HttpOnly and SameSite=Lax", async ({ apiAs }) => {
    const api = await apiAs(null);
    const response = await api.post("/api/auth/sign-in/email", {
      data: { email: E2E_USERS.ACCOUNTANT.email, password: E2E_PASSWORD },
    });
    expect(response.ok()).toBe(true);

    const sessionCookie = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .find((value) => /session_token=/.test(value));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(sessionCookie).toMatch(/;\s*Path=\//i);
  });

  test("signing out ends the session on the server, not just in the browser", async ({ apiAs, playwright, baseURL }) => {
    const api = await apiAs(null);
    await api.post("/api/auth/sign-in/email", { data: { email: E2E_USERS.ACCOUNTANT.email, password: E2E_PASSWORD } });
    const stolen = await api.storageState();
    expect((await api.get("/api/v1/me")).status()).toBe(200);

    await api.post("/api/auth/sign-out", { data: {} });

    // Someone who copied the cookie before sign-out cannot use it afterwards.
    const replay = await playwright.request.newContext({ baseURL, storageState: stolen });
    try {
      expect((await replay.get("/api/v1/me")).status()).toBe(401);
    } finally {
      await replay.dispose();
    }
  });

  test("a forged session cookie is rejected", async ({ playwright, baseURL }) => {
    const forged = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: "better-auth.session_token=forged-token.forged-signature" },
    });
    try {
      expect((await forged.get("/api/v1/me")).status()).toBe(401);
    } finally {
      await forged.dispose();
    }
  });
});
