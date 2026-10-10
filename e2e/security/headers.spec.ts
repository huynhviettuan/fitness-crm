// OWASP A02:2025 Security Misconfiguration — response headers and Content Security Policy.
import { expect, signedInAs, test } from "../fixtures";
import { E2E_PASSWORD, E2E_USERS } from "../support/db";

function nonceOf(csp: string | undefined): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

test.describe("A02 security headers", () => {
  for (const path of ["/login", "/api/v1/auth/me"]) {
    test(`${path} sends the baseline headers and hides the framework`, async ({ apiAs }) => {
      const response = await (await apiAs(null)).get(path);
      const headers = response.headers();

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("pages send a strict Content Security Policy with a fresh nonce per request", async ({ apiAs }) => {
    const api = await apiAs(null);
    const first = (await api.get("/login")).headers()["content-security-policy"];
    const second = (await api.get("/login")).headers()["content-security-policy"];

    expect(first).toContain("default-src 'self'");
    expect(first).toContain("frame-ancestors 'none'");
    expect(first).toContain("object-src 'none'");
    expect(first).toContain("base-uri 'self'");
    expect(first).toContain("form-action 'self'");
    expect(first).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(first?.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });
});

test.describe("A02 the app works under its Content Security Policy", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("no CSP violations while using the main screens", async ({ page, shell, customersPage }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(message.text())) violations.push(message.text());
    });

    await page.goto("/dashboard");
    await customersPage.goto();
    const sheet = await customersPage.openCreate();
    await sheet.save(); // triggers client-side validation rendering
    await page.keyboard.press("Escape");
    await (await shell.openCustomerSearch()).getByRole("combobox").fill("nguyen");

    expect(violations).toEqual([]);
  });
});

test.describe("A02 login page under CSP", () => {
  test("signing in works with scripts restricted by nonce", async ({ page, loginPage, shell }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });

    await loginPage.goto();
    await loginPage.signIn(E2E_USERS.MANAGER.email, E2E_PASSWORD);

    await expect(shell.main).toBeVisible();
    expect(violations).toEqual([]);
  });
});
