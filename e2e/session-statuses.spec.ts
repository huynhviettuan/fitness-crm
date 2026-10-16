import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

// The session statuses and their rules (brief §6.2, D-025; docs/13 E2E-167). The screen only reads here: the rules are
// shared by every spec, so changing one is left to the integration tests (INT: a changed rule affects new changes only).
const s = labels.sessionStatuses;

test.describe("as an Admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-167: the statuses show the brief's table, and a rule opens for editing", async ({ page }) => {
    await page.goto("/admin/session-statuses");

    await expect(page.getByRole("heading", { level: 1, name: s.title })).toBeVisible();
    const table = page.getByRole("table", { name: s.title });
    for (const [code, label] of [
      ["BOOKED", "Booked"],
      ["TRAINED", "Đã tập"],
      ["CANCELLED", "Hủy lịch"],
      ["NO_SHOW", "Khách không đến"],
    ]) {
      await expect(table.getByRole("row").filter({ hasText: code })).toContainText(label);
    }

    await page.getByRole("button", { name: s.rowActions.replace("{name}", "Khách không đến") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(s.fields.consumes)).toBeChecked();
    await dialog.getByRole("button", { name: labels.common.cancel, exact: true }).click();
    await expect(dialog).toBeHidden();

    // Booking itself never uses a session: its flags are not offered.
    await page.getByRole("button", { name: s.rowActions.replace("{name}", "Booked") }).click();
    await expect(page.getByRole("dialog").getByLabel(s.fields.consumes)).toHaveCount(0);
  });

  test("the rules are Admin's: a manager is refused by the API, and a bad color is a 400", async ({ apiAs }) => {
    const body = {
      labelVi: "Đã tập",
      labelEn: "Trained",
      consumes: true,
      creditsPt: true,
      locksOnSet: true,
      color: "info",
    };

    expect(
      (await (await apiAs("FITNESS_MANAGER")).put("/api/v1/session-statuses/TRAINED", { data: body })).status(),
    ).toBe(403);
    expect(
      (
        await (await apiAs("ADMIN")).put("/api/v1/session-statuses/TRAINED", { data: { ...body, color: "#f00" } })
      ).status(),
    ).toBe(400);
    expect((await (await apiAs("ADMIN")).put("/api/v1/session-statuses/NOPE", { data: body })).status()).toBe(404);
    // Anyone signed in reads them; anonymous does not.
    expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/session-statuses")).status()).toBe(200);
    expect((await (await apiAs(null)).get("/api/v1/session-statuses")).status()).toBe(401);
  });
});

test.describe("as a Receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("the screen is not theirs", async ({ page }) => {
    await page.goto("/admin/session-statuses");

    await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});
