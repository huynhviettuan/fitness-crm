import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

// The lead intake gateway (brief §11, D-044; M10.1, docs/13 E2E-179): Admin registers a source and gets its key once; the
// website posts a submission with it; the lead appears with the message on its page.
const t = labels.intake;

test.describe("as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-179: a source is registered, its key works once shown, and the lead shows the message", async ({
    page,
    apiAs,
    testTag,
  }) => {
    await page.goto("/admin/intake");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
    await page.getByRole("button", { name: t.add }).click();
    const dialog = page.getByRole("dialog", { name: t.add });
    await dialog.getByLabel(t.fields.name).fill(`Website ${testTag}`);
    // One branch in the specs' database, so it is already chosen.
    await dialog.getByRole("combobox", { name: t.fields.channel }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await dialog.getByRole("button", { name: t.register }).click();

    const key = (await page.getByTestId("intake-key").textContent())?.trim() ?? "";
    expect(key).toMatch(/^fci_/);
    await page.getByRole("button", { name: t.keyDone }).click();
    const row = page.getByRole("row", { name: new RegExp(`Website ${testTag}`) });
    await expect(row).toBeVisible();
    await expect(row.getByText(t.active, { exact: true })).toBeVisible();

    // The website's server posts with the key; the browser is not involved.
    const sender = await apiAs(null, { origin: null });
    const sent = await sender.post("/api/v1/intake/website", {
      headers: { "x-intake-key": key },
      data: {
        externalId: `form-${testTag}`,
        name: `Khách ${testTag}`,
        message: `Tôi muốn tập thử ${testTag}`,
        pageUrl: "https://flow.vn/pt",
      },
    });
    expect(sent.status()).toBe(200);
    const { personId } = (await sent.json()) as { personId: string };

    await page.reload();
    await expect(
      page
        .getByRole("row", { name: new RegExp(`Website ${testTag}`) })
        .getByRole("cell")
        .nth(6),
    ).toHaveText("1");

    await page.goto(`/leads/${personId}`);
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText(`Tôi muốn tập thử ${testTag}`)).toBeVisible();
    await expect(conversation.getByText(`Website ${testTag}`)).toBeVisible();

    // Turned off, the key stops working.
    await page.goto("/admin/intake");
    await page
      .getByRole("row", { name: new RegExp(`Website ${testTag}`) })
      .getByRole("button", { name: t.deactivate })
      .click();
    await expect(page.getByRole("row", { name: new RegExp(`Website ${testTag}`) }).getByText(t.inactive)).toBeVisible();
    const refused = await sender.post("/api/v1/intake/website", {
      headers: { "x-intake-key": key },
      data: { externalId: `again-${testTag}`, name: `Khách ${testTag}` },
    });
    expect(refused.status()).toBe(401);
  });
});

test.describe("as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("the sources are not for everyone: no menu entry, and the page says so", async ({ page }) => {
    await page.goto("/admin/intake");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toHaveCount(0);
    await expect(page.getByRole("link", { name: labels.nav.intakeSources })).toHaveCount(0);
  });
});
