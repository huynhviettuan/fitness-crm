import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

// Staff notifications by email and on the phone (D-053, D-056; docs/13 E2E-115). The browser's own push cannot run in the
// test browser and the push provider is the logging one, so the screens are tested for what they show and save; the
// sending is covered by the API's integration tests with the providers mocked at their boundary.
const s = labels.staffNotifications;
const n = labels.notificationSettings;

const DEFAULTS = {
  items: [
    "taskDueSoon",
    "taskOverdue",
    "approvalSubmitted",
    "approvalOverdue",
    "leadAssigned",
    "leadReclaimed",
    "sessionHanging",
  ].map((kind) => ({ kind, email: true, push: true })),
};

test.describe("a manager's notification choices", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test.afterEach(async ({ apiAs }) => {
    await (await apiAs("FITNESS_MANAGER")).put("/api/v1/notification-preferences", { data: DEFAULTS });
  });

  test("@smoke E2E-115: the manager turns an email off, a mandatory one cannot be turned off, and the choice stays", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: labels.userMenu.label }).click();
    await page.getByRole("menuitem", { name: labels.userMenu.notifications }).click();
    await expect(page.getByRole("heading", { level: 1, name: s.title })).toBeVisible();

    const table = page.getByRole("table", { name: s.choices });
    const switchOf = (kind: string, channel: string) =>
      table.getByRole("switch", { name: `${kind} · ${channel}`, exact: true });
    // Everything is on to begin with; an overdue task is mandatory by email (the system's starting marks).
    await expect(switchOf("Việc sắp đến hạn", s.fields.email)).toBeChecked();
    await expect(switchOf("Việc quá hạn", s.fields.email)).toBeDisabled();
    await expect(table.getByRole("row").filter({ hasText: "Việc quá hạn" })).toContainText(s.mandatory);

    await switchOf("Việc sắp đến hạn", s.fields.email).click();
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(s.saved)).toBeVisible();

    await page.reload();
    await expect(switchOf("Việc sắp đến hạn", s.fields.email)).not.toBeChecked();
    await expect(switchOf("Việc sắp đến hạn", s.fields.push)).toBeChecked();
    // This test browser has no push key set up, and says so.
    await expect(page.getByTestId("push-state")).toHaveText(s.device.state.notSetUp);
  });
});

test.describe("the mandatory marks as admin", () => {
  test.use(signedInAs("ADMIN"));

  test.afterEach(async ({ apiAs }) => {
    const items = [
      "taskDueSoon",
      "taskOverdue",
      "approvalSubmitted",
      "approvalOverdue",
      "leadAssigned",
      "leadReclaimed",
      "sessionHanging",
    ].map((kind) => ({
      kind,
      emailMandatory: ["taskOverdue", "approvalOverdue", "sessionHanging"].includes(kind),
      pushMandatory: false,
    }));
    await (await apiAs("ADMIN")).put("/api/v1/notification-settings", { data: { items } });
  });

  test("admin marks an email mandatory and the employee sees it locked", async ({ page, apiAs }) => {
    await page.goto("/admin/notification-settings");
    const table = page.getByRole("table", { name: n.title });
    await table.getByRole("switch", { name: `Lead mới được giao · ${n.fields.emailMandatory}`, exact: true }).click();
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(n.saved)).toBeVisible();

    const settings = (await (await (await apiAs("ADMIN")).get("/api/v1/notification-settings")).json()) as {
      items: { kind: string; emailMandatory: boolean }[];
    };
    expect(settings.items.find((item) => item.kind === "leadAssigned")?.emailMandatory).toBe(true);
    const preferences = (await (
      await (await apiAs("FITNESS_MANAGER")).get("/api/v1/notification-preferences")
    ).json()) as {
      items: { kind: string; emailMandatory: boolean }[];
    };
    expect(preferences.items.find((item) => item.kind === "leadAssigned")?.emailMandatory).toBe(true);
  });
});

test.describe("who may set the marks", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("reception has choices of its own but not the marks", async ({ page, apiAs }) => {
    await page.goto("/account/notifications");
    await expect(page.getByRole("heading", { level: 1, name: s.title })).toBeVisible();

    await page.goto("/admin/notification-settings");
    await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
    expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/notification-settings")).status()).toBe(403);
  });
});
