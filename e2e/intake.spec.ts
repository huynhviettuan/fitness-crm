import { createHash, createHmac } from "node:crypto";
import { expect, signedInAs, test } from "./fixtures";
import { GRAPH_STUB_PORT } from "./support/graph";
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
        pageUrl: "https://demogym.vn/pt",
      },
    });
    expect(sent.status()).toBe(200);
    const { personId } = (await sent.json()) as { personId: string };

    await page.reload();
    // The "received" cell is found by its column header, so a new column does not move it.
    const headers = await page.getByRole("columnheader").allTextContents();
    await expect(
      page
        .getByRole("row", { name: new RegExp(`Website ${testTag}`) })
        .getByRole("cell")
        .nth(headers.indexOf(t.fields.received)),
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

  test("@smoke E2E-181: a Messenger source is connected and a message from the page becomes a lead with its conversation", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const secret = "UiMessengerSecret0123456789abcdef";
    await page.goto("/admin/intake");
    await page.getByRole("button", { name: t.add }).click();
    const dialog = page.getByRole("dialog", { name: t.add });
    await dialog.getByLabel(t.fields.name).fill(`Messenger ${testTag}`);
    await dialog.getByRole("combobox", { name: t.fields.kind }).click();
    await page.getByRole("listbox").getByRole("option", { name: t.kinds.MESSENGER }).click();
    await dialog.getByRole("combobox", { name: t.fields.channel }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await dialog.getByLabel(t.fields.appSecret).fill(secret);
    await dialog.getByRole("button", { name: t.register }).click();

    const url = (await page.getByTestId("intake-webhook-url").textContent())?.trim() ?? "";
    expect(url).toMatch(/\/api\/v1\/intake\/meta\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: t.webhookDone }).click();

    const meta = await apiAs(null, { origin: null });
    const sender = String(1_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE",
          messaging: [
            {
              sender: { id: sender },
              timestamp: Date.now(),
              message: { mid: `m.${testTag}`, text: `Giá PT ${testTag}` },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const sent = await meta.post(new URL(url).pathname, {
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      data: body,
    });
    expect(sent.status()).toBe(200);

    await page.goto(`/leads?q=${encodeURIComponent(`Messenger ${sender.slice(-6)}`)}`);
    await page
      .getByRole("link", { name: `Messenger ${sender.slice(-6)}` })
      .first()
      .click();
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation.getByText(`Giá PT ${testTag}`)).toBeVisible();
    await expect(conversation.getByText(`Messenger ${testTag}`)).toBeVisible();
  });

  test("@smoke E2E-182: a Page token is set and a Lead Ads form becomes a lead with its answers", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const secret = "UiLeadAdsSecret0123456789abcdefAB";
    const admin = await apiAs("ADMIN");
    const channels = (await (await admin.get("/api/v1/option-lists/leadChannels/options")).json()) as {
      items: { id: string; isOther: boolean }[];
    };
    const created = await admin.post("/api/v1/intake/sources", {
      data: {
        name: `Trang ${testTag}`,
        kind: "MESSENGER",
        channelId: channels.items.find((option) => !option.isOther)!.id,
        appSecret: secret,
      },
    });
    const { source } = (await created.json()) as { source: { id: string; webhookPath: string } };

    // Admin gives the source the Page token from the screen.
    await page.goto("/admin/intake");
    const row = page.getByRole("row", { name: new RegExp(`Trang ${testTag}`) });
    await expect(row.getByText(t.leadAdsOff)).toBeVisible();
    await row.getByRole("button", { name: t.pageToken }).click();
    const dialog = page.getByRole("dialog", { name: t.pageTokenTitle });
    await dialog.getByLabel(t.pageToken).fill(`EAAB${"x".repeat(60)}`);
    await dialog.getByRole("button", { name: t.pageTokenSave }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText(t.leadAdsOn)).toBeVisible();

    // Someone fills the form; Meta keeps the answers and tells the Page.
    const leadId = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    await (
      await apiAs(null, { origin: null })
    ).post(`http://localhost:${GRAPH_STUB_PORT}/__leads`, {
      data: {
        id: leadId,
        field_data: [
          { name: "full_name", values: [`Khách form ${testTag}`] },
          { name: "phone_number", values: [`+849${leadId.slice(-8)}`] },
          { name: "Bạn muốn tập gì?", values: [`PT buổi tối ${testTag}`] },
        ],
      },
    });
    const body = JSON.stringify({
      object: "page",
      entry: [{ id: "PAGE", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadId, form_id: "1" } }] }],
    });
    const meta = await apiAs(null, { origin: null });
    const sent = await meta.post(source.webhookPath, {
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      },
      data: body,
    });
    expect(await sent.json()).toEqual({ received: 1, duplicates: 0 });

    await page.goto(`/leads?q=${encodeURIComponent(`Khách form ${testTag}`)}`);
    await page
      .getByRole("link", { name: `Khách form ${testTag}` })
      .first()
      .click();
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation.getByText(`Bạn muốn tập gì?: PT buổi tối ${testTag}`)).toBeVisible();
  });

  test("@smoke E2E-183: an email source is registered, Gmail's confirmation shows for Admin, and an email becomes a lead", async ({
    page,
    apiAs,
    testTag,
  }) => {
    await page.goto("/admin/intake");
    await page.getByRole("button", { name: t.add }).click();
    const dialog = page.getByRole("dialog", { name: t.add });
    await dialog.getByLabel(t.fields.name).fill(`Gmail ${testTag}`);
    await dialog.getByRole("combobox", { name: t.fields.kind }).click();
    await page.getByRole("listbox").getByRole("option", { name: t.kinds.EMAIL }).click();
    await dialog.getByRole("combobox", { name: t.fields.channel }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await dialog.getByRole("button", { name: t.register }).click();

    const inbound = new URL((await page.getByTestId("intake-inbound-url").textContent())?.trim() ?? "");
    const key = (await page.getByTestId("intake-key").textContent())?.trim() ?? "";
    expect(inbound.pathname).toBe("/api/v1/intake/email");
    expect(decodeURIComponent(inbound.password)).toBe(key);
    await page.getByRole("button", { name: t.keyDone }).click();

    // The inbound-mail service posts with the credentials of the address, as HTTP Basic authentication.
    const service = await apiAs(null, { origin: null });
    const post = (data: Record<string, unknown>) =>
      service.post(inbound.pathname, {
        headers: { authorization: `Basic ${Buffer.from(`${inbound.username}:${key}`).toString("base64")}` },
        data: { Headers: [], ...data },
      });
    const confirmation = await post({
      MessageID: `confirm-${testTag}`,
      FromFull: { Email: "forwarding-noreply@google.com", Name: "Gmail Team" },
      Subject: "(#555666777) Gmail Forwarding Confirmation",
      TextBody: `Confirmation code: 555666777 ${testTag}`,
    });
    expect(await confirmation.json()).toEqual({ received: 0, duplicates: 0 });
    await page.reload();
    await expect(
      page.getByRole("row", { name: new RegExp(`Gmail ${testTag}`) }).getByTestId("intake-notice"),
    ).toContainText(`Confirmation code: 555666777 ${testTag}`);

    const sent = await post({
      MessageID: `mail-${testTag}`,
      FromFull: { Email: `an.${testTag.toLowerCase()}@example.com`, Name: `Khách mail ${testTag}` },
      Subject: `Hỏi giá PT ${testTag}`,
      TextBody: "Mình muốn tập buổi tối.",
    });
    expect(await sent.json()).toEqual({ received: 1, duplicates: 0 });
    await page.goto(`/leads?q=${encodeURIComponent(`Khách mail ${testTag}`)}`);
    await page
      .getByRole("link", { name: `Khách mail ${testTag}` })
      .first()
      .click();
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation.getByText(`Hỏi giá PT ${testTag}`)).toBeVisible();
  });

  test("@smoke E2E-184: a Zalo OA source is connected and a user's message becomes a lead with its conversation", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const secret = "UiZaloOaSecretKey0123456789";
    const appId = "360846524940903967";
    await page.goto("/admin/intake");
    await page.getByRole("button", { name: t.add }).click();
    const dialog = page.getByRole("dialog", { name: t.add });
    await dialog.getByLabel(t.fields.name).fill(`Zalo ${testTag}`);
    await dialog.getByRole("combobox", { name: t.fields.kind }).click();
    await page.getByRole("listbox").getByRole("option", { name: t.kinds.ZALO }).click();
    await dialog.getByRole("combobox", { name: t.fields.channel }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    // Registering waits for the app id and the OA secret key.
    await expect(dialog.getByRole("button", { name: t.register })).toBeDisabled();
    await dialog.getByLabel(t.fields.appId).fill(appId);
    await dialog.getByLabel(t.fields.oaSecret).fill(secret);
    await dialog.getByRole("button", { name: t.register }).click();

    const url = new URL((await page.getByTestId("intake-webhook-url").textContent())?.trim() ?? "");
    expect(url.pathname).toMatch(/^\/api\/v1\/intake\/zalo\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("intake-key")).toHaveCount(0);
    await page.getByRole("button", { name: t.webhookDone }).click();
    // Nothing to replace on a Zalo source.
    await expect(
      page.getByRole("row", { name: new RegExp(`Zalo ${testTag}`) }).getByRole("button", { name: t.newKey }),
    ).toHaveCount(0);

    const user = String(1_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    const body = JSON.stringify({
      app_id: appId,
      sender: { id: user },
      recipient: { id: "388613280878808645" },
      event_name: "user_send_text",
      message: { text: `Giá PT ${testTag}`, msg_id: `zm.${testTag}` },
      timestamp: String(Date.now()),
    });
    const timestamp = (JSON.parse(body) as { timestamp: string }).timestamp;
    const mac = createHash("sha256").update(appId).update(body).update(timestamp).update(secret).digest("hex");
    const zalo = await apiAs(null, { origin: null });
    const sent = await zalo.post(url.pathname, {
      headers: { "content-type": "application/json", "x-zevent-signature": `mac=${mac}` },
      data: body,
    });
    expect(await sent.json()).toEqual({ received: 1, duplicates: 0 });

    await page.goto(`/leads?q=${encodeURIComponent(`Zalo ${user.slice(-6)}`)}`);
    await page
      .getByRole("link", { name: `Zalo ${user.slice(-6)}` })
      .first()
      .click();
    const conversation = page.getByRole("region", { name: t.conversation });
    await expect(conversation.getByText(`Giá PT ${testTag}`)).toBeVisible();
    await expect(conversation.getByText(`Zalo ${testTag}`)).toBeVisible();
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
