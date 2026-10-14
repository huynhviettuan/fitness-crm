import { createHmac } from "node:crypto";
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

  test("@smoke E2E-180: a WhatsApp source is connected, its message becomes a lead, and a follow-up joins the conversation", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const secret = "UiAppSecret0123456789abcdefABCDEF";
    await page.goto("/admin/intake");
    await page.getByRole("button", { name: t.add }).click();
    const dialog = page.getByRole("dialog", { name: t.add });
    await dialog.getByLabel(t.fields.name).fill(`WhatsApp ${testTag}`);
    await dialog.getByRole("combobox", { name: t.fields.kind }).click();
    await page.getByRole("listbox").getByRole("option", { name: t.kinds.WHATSAPP }).click();
    await dialog.getByRole("combobox", { name: t.fields.channel }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    // The register button waits for the Meta app secret.
    await expect(dialog.getByRole("button", { name: t.register })).toBeDisabled();
    await dialog.getByLabel(t.fields.appSecret).fill(secret);
    await dialog.getByRole("button", { name: t.register }).click();

    const url = (await page.getByTestId("intake-webhook-url").textContent())?.trim() ?? "";
    const verifyToken = (await page.getByTestId("intake-verify-token").textContent())?.trim() ?? "";
    expect(url).toMatch(/\/api\/v1\/intake\/whatsapp\/[0-9a-f-]{36}$/);
    expect(verifyToken.length).toBeGreaterThan(20);
    await page.getByRole("button", { name: t.webhookDone }).click();

    // Meta registers the webhook, then delivers.
    const meta = await apiAs(null, { origin: null });
    const path = new URL(url).pathname;
    const handshake = await meta.get(
      `${path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=4242`,
    );
    expect(await handshake.text()).toBe("4242");
    const phone = `849${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
    const send = async (id: string, text: string) => {
      const body = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ wa_id: phone, profile: { name: `Khách ${testTag}` } }],
                  messages: [
                    {
                      from: phone,
                      id,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: text },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      return meta.post(path, {
        headers: { "content-type": "application/json", "x-hub-signature-256": signature },
        data: body,
      });
    };
    expect((await send(`wamid.a.${testTag}`, `Tôi muốn tập PT ${testTag}`)).status()).toBe(200);
    expect((await send(`wamid.b.${testTag}`, `Giá bao nhiêu ${testTag}`)).status()).toBe(200);

    await page.goto("/leads");
    await page
      .getByRole("link", { name: new RegExp(`Khách ${testTag}`) })
      .first()
      .click();
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation.getByText(`Tôi muốn tập PT ${testTag}`)).toBeVisible();
    await expect(conversation.getByText(`Giá bao nhiêu ${testTag}`)).toBeVisible();
    // One lead, not two: the follow-up joined the conversation.
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: new RegExp(`Khách ${testTag}`) })).toHaveCount(1);
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
