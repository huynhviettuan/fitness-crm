import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Two main flows, step by step, as frames for the README's GIFs (docs/images/flow-*.gif, assembled by
// scripts/frames-to-gif.py). Changes the demo data (a lead's status, a booking): run on a freshly seeded demo database;
// see tour.config.ts.

const FRAMES = path.join(import.meta.dirname, "..", "test-results", "tour-frames");
const EMAIL = process.env.TOUR_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.TOUR_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "";

/** dd/MM/yyyy of a day after today, in the gym's time zone. */
function dayAfterToday(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return parts;
}

function frames(flow: string) {
  const dir = path.join(FRAMES, flow);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let index = 0;
  return async (page: Page) => {
    await page.mouse.move(0, 0);
    index += 1;
    await page.screenshot({ path: path.join(dir, `${String(index).padStart(2, "0")}.png`) });
  };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function choose(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: option }).first().click();
}

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "Set TOUR_EMAIL and TOUR_PASSWORD (or the seed admin in apps/api/.env)");
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
});

test("a lead gets an appointment", async ({ page }) => {
  const frame = frames("lead-appointment");
  const leads = (await (await page.request.get("/api/v1/leads?status=CONSULTING")).json()) as {
    items: { id: string; fullName: string }[];
  };
  const lead = leads.items.at(-1)!;

  await page.goto(`/leads/${lead.id}`);
  await expect(page.getByRole("heading", { level: 1, name: lead.fullName })).toBeVisible();
  await frame(page);

  await page.getByRole("button", { name: "Change status", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await frame(page);

  await choose(page, dialog, "New status", "Appointment booked");
  await expect(dialog.getByLabel("Appointment date", { exact: true })).toBeVisible();
  await dialog.getByLabel("Appointment date", { exact: true }).fill(dayAfterToday(2));
  await dialog.getByLabel("Appointment time", { exact: true }).fill("18:30");
  await frame(page);

  await dialog.getByRole("button", { name: "Save status", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The journey's badge and the history's new line, once the page has refreshed; the toast gone.
  await expect(page.getByRole("main").getByText("Appointment booked", { exact: true })).not.toHaveCount(0);
  await expect(page.getByRole("main").getByText("Appointment booked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Status changed", { exact: true })).toBeHidden({ timeout: 10_000 });
  await frame(page);
});

test("a PT session is booked on the calendar", async ({ page }) => {
  const frame = frames("pt-booking");
  const tomorrow = dayAfterToday(1);

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "PT Calendar" })).toBeVisible();
  await frame(page);

  await page.getByRole("button", { name: "Add booking", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add booking" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Customer", { exact: true }).fill("Nguyễn Văn An");
  await dialog.getByRole("option").first().click();
  await frame(page);

  await choose(page, dialog, "Contract", /PT/);
  await choose(page, dialog, "Trainer", "Trần Minh Khoa");
  await dialog.getByLabel("Date", { exact: true }).fill(tomorrow);
  await dialog.getByLabel("Start time", { exact: true }).fill("09:00");
  await dialog.getByLabel("End time", { exact: true }).fill("10:00");
  await frame(page);

  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByPlaceholder("dd/mm/yyyy").fill(tomorrow);
  await page.getByRole("button", { name: "Go to date", exact: true }).click();
  await expect(page.getByText(`Schedule for ${tomorrow}`, { exact: true })).toBeVisible();
  // 09:00 fits the first screen of the day, with the trainers' names above it.
  await expect(page.getByRole("main").getByText("09:00–10:00", { exact: true })).toBeVisible();
  await expect(page.getByText("Booking added", { exact: true })).toBeHidden({ timeout: 10_000 });
  await frame(page);
});
