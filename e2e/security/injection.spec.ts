// OWASP A05:2025 Injection — SQL and script payloads are stored as plain text and
// rendered inert.
import { expect, signedInAs, test } from "../fixtures";

const PAYLOADS = [
  "'; DROP TABLE customers; --",
  "Robert'); DELETE FROM users; --",
  "<script>alert('xss')</script>",
  '"><img src=x onerror=alert(1)>',
  "{{7*7}} ${7*7} #{7*7}",
];

test.use(signedInAs("RECEPTIONIST"));

test.describe("A05 injection payloads", () => {
  for (const [index, payload] of PAYLOADS.entries()) {
    test(`payload ${index + 1} is stored verbatim and rendered as text`, async ({ page, apiAs, testTag, customerDetailPage }) => {
      const api = await apiAs("RECEPTIONIST");
      const fullName = `${payload} ${testTag}`;
      const response = await api.post("/api/v1/customers", { data: { fullName, phone: "0909200100", notes: payload } });
      expect(response.status()).toBe(201);
      const customer = await response.json();
      expect(customer).toMatchObject({ fullName, notes: payload });

      // Rendering it must not run anything.
      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });
      await page.goto(`/customers/${customer.id}`);

      await expect(customerDetailPage.heading(fullName)).toBeVisible();
      expect(dialogs).toEqual([]);
    });
  }

  test("SQL in the search box matches nothing instead of everything", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST");
    await api.post("/api/v1/customers", { data: { fullName: `Search ${testTag}`, phone: "0909200200" } });

    for (const search of ["' OR '1'='1", "%' OR 1=1 --", "\\' UNION SELECT * FROM users --"]) {
      const response = await api.get(`/api/v1/customers?search=${encodeURIComponent(search)}`);
      expect(response.status(), search).toBe(200);
      expect((await response.json()).total, search).toBe(0);
    }
  });
});
