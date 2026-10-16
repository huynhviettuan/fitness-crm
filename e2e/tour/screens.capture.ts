import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Screenshots of the main screens for the README (docs/images), on the demo data, in English.
// Run with `pnpm --filter e2e tour`; see tour.config.ts.

const OUT = path.join(import.meta.dirname, "..", "..", "docs", "images");
const EMAIL = process.env.TOUR_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.TOUR_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Opens a page, waits for it to settle, and saves it as docs/images/<name>.png. */
async function shot(page: Page, name: string, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  // Toasts, tooltips and the cursor out of the way.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** The first item of a list endpoint, read through the web app with the signed-in session. */
async function first(page: Page, endpoint: string): Promise<{ id: string }> {
  const answer = await page.request.get(endpoint);
  const body = (await answer.json()) as { items: { id: string }[] };
  if (!body.items[0]) throw new Error(`No item at ${endpoint}: run pnpm db:seed:demo`);
  return body.items[0];
}

test("the main screens", async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "Set TOUR_EMAIL and TOUR_PASSWORD (or the seed admin in apps/api/.env)");
  await signIn(page);

  const lead = await first(page, "/api/v1/leads?status=CONSULTING");
  const customer = await first(page, `/api/v1/customers?search=${encodeURIComponent("Nguyễn Văn An")}`);
  const contract = await first(page, "/api/v1/contracts?pageSize=20");
  const role = (await (await page.request.get("/api/v1/roles")).json()) as { items: { id: string; code: string }[] };
  const receptionRole = role.items.find((item) => item.code === "RECEPTIONIST") ?? role.items[0]!;

  await shot(page, "01-dashboard", "/dashboard");
  await shot(page, "02-leads", "/leads");
  await shot(page, "03-lead", `/leads/${lead.id}`);
  await shot(page, "04-customer", `/customers/${customer.id}`);
  await shot(page, "05-contract", `/contracts/${contract.id}`);
  await shot(page, "06-pt-calendar", "/calendar");
  await shot(page, "07-cash-book", "/reports/cash-book");
  await shot(page, "08-permissions", `/admin/roles/${receptionRole.id}`);
  // The background jobs run inside the API here; their first runs come within a minute or two.
  await expect
    .poll(
      async () => {
        const status = (await (await page.request.get("/api/v1/system/status")).json()) as {
          jobs: { name: string; state: string }[];
        };
        return status.jobs.filter((job) => job.name !== "backup").every((job) => job.state === "ok");
      },
      { timeout: 150_000, intervals: [5_000] },
    )
    .toBe(true);
  await shot(page, "09-system-status", "/admin/system");

  // The phone layout (AC-23): a lead as a consultant sees it on the floor.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "10-phone-lead", `/leads/${lead.id}`);
});
