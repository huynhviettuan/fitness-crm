import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, createScriptViaApi } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// The script library and lead notes (brief §4.1; FR-LEAD-006, FR-LEAD-010; A-072 to A-074;
// docs/13 E2E-123 to E2E-125). Scripts and leads carry the test's tag; teardown removes them.
const sc = labels.scripts;
const l = labels.leads;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.describe("the script library", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-123: a manager adds a script, edits it, switches it off, and reorders the library", async ({
    page,
    scriptsAdminPage,
    testTag,
  }) => {
    const situation = `Giá thử ${testTag}`;

    await scriptsAdminPage.goto();
    // The brief's 12 situations are there from the start.
    await expect(scriptsAdminPage.row("Chào lần đầu")).toBeVisible();
    await expect(scriptsAdminPage.row("Kết thúc tư vấn")).toBeVisible();

    const created = await scriptsAdminPage.openCreate();
    await created.fill({
      situationVi: situation,
      situationEn: `Trial price ${testTag}`,
      answerVi: "Gói thử giá 500.000đ.",
    });
    await created.save();
    await expect(toasts(page).getByText(fill(sc.created, { name: situation }))).toBeVisible();
    await expect(scriptsAdminPage.row(situation)).toContainText("VI");
    await expect(scriptsAdminPage.row(situation)).not.toContainText("EN");
    // It goes after the 12 the brief names (other tests add theirs at the same time, so not "last").
    const order = await scriptsAdminPage.situations();
    expect(order.indexOf(situation)).toBeGreaterThanOrEqual(12);

    const edit = await scriptsAdminPage.openEdit(situation);
    await edit.field(sc.fields.answerEn).fill("Trial pack for 500,000 VND.");
    await edit.save();
    await expect(toasts(page).getByText(sc.saved)).toBeVisible();
    await expect(scriptsAdminPage.row(situation)).toContainText("EN");

    // Other tests add scripts at the same time; an order made from a list that has since grown is
    // refused (the whole library is sent), so the move is tried again from a fresh page.
    let before = -1;
    await expect(async () => {
      await scriptsAdminPage.goto();
      before = (await scriptsAdminPage.situations()).indexOf(situation);
      await scriptsAdminPage.moveUp(situation).click();
      await expect(toasts(page).getByText(sc.reordered)).toBeVisible({ timeout: 3000 });
    }).toPass();
    await scriptsAdminPage.goto();
    // Moved up (a retry after a toast that came late may have moved it once more).
    expect((await scriptsAdminPage.situations()).indexOf(situation)).toBeLessThan(before);

    const off = await scriptsAdminPage.openEdit(situation);
    await off.root.getByRole("switch", { name: sc.fields.active }).click();
    await off.save();
    await expect(scriptsAdminPage.row(situation)).toContainText(labels.status.option.INACTIVE);
  });

  test("a script with markup in it is shown as text, never run", async ({ apiAs, page, scriptsAdminPage, testTag }) => {
    const payload = `<img src=x onerror="window.__xss=1">${testTag}`;
    await createScriptViaApi(await apiAs("FITNESS_MANAGER"), {
      situationVi: payload,
      situationEn: payload,
      answerVi: payload,
    });

    await scriptsAdminPage.goto();

    await expect(page.getByText(payload, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("a script needs both situation names", async ({ scriptsAdminPage }) => {
    await scriptsAdminPage.goto();
    const dialog = await scriptsAdminPage.openCreate();

    await dialog.save();

    await expect(dialog.fieldErrors).toHaveText([labels.validation.required, labels.validation.required]);
    await expect(dialog.root).toBeVisible();
  });
});

test.describe("scripts on a phone", () => {
  test.use({
    ...signedInAs("CONSULTING"),
    viewport: { width: 375, height: 812 },
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test("E2E-124: a consultant copies the answer in the lead's language, and the clipboard holds that text", async ({
    page,
    apiAs,
    leadPage,
    shell,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const situation = `Giá Hybrid ${testTag}`;
    await createScriptViaApi(manager, {
      situationVi: situation,
      situationEn: `Hybrid price ${testTag}`,
      answerVi: "Gói Hybrid 12 buổi giá 6.500.000đ.",
      answerEn: "The 12-session Hybrid pack is 6,500,000 VND.",
    });
    // A script without an answer is not offered to a consultant.
    await createScriptViaApi(manager, { situationVi: `Chưa có ${testTag}`, situationEn: `Empty ${testTag}` });
    const reception = await apiAs("RECEPTIONIST");
    const foreign = await createLeadViaApi(reception, {
      fullName: `Khách Tây ${testTag}`,
      countryCode: "US",
    });
    const local = await createLeadViaApi(reception, { fullName: `Khách Việt ${testTag}` });

    await leadPage.goto(foreign.id);
    await expect(leadPage.heading(foreign.fullName)).toBeVisible();
    const panel = await leadPage.openScripts();
    // A foreigner's answers come in English first.
    await expect(panel.getByRole("button", { name: l.scripts.en })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: `Hybrid price ${testTag}` })).toBeVisible();
    await expect(panel.getByRole("button", { name: `Empty ${testTag}` })).toHaveCount(0);
    await panel.getByRole("button", { name: `Hybrid price ${testTag}` }).click();
    await panel.getByRole("button", { name: l.scripts.copy }).click();
    await expect(toasts(page).getByText(l.scripts.copied)).toBeVisible();
    expect(await clipboard(page)).toBe("The 12-session Hybrid pack is 6,500,000 VND.");

    // The consultant can switch language on the panel.
    await panel.getByRole("button", { name: l.scripts.vi }).click();
    await panel.getByRole("button", { name: situation }).click();
    await panel.getByRole("button", { name: l.scripts.copy }).click();
    expect(await clipboard(page)).toBe("Gói Hybrid 12 buổi giá 6.500.000đ.");
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);

    // A Vietnamese lead starts in Vietnamese.
    await page.keyboard.press("Escape");
    await leadPage.goto(local.id);
    const again = await leadPage.openScripts();
    await expect(again.getByRole("button", { name: l.scripts.vi })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("lead notes", () => {
  test.use(signedInAs("CONSULTING"));

  test("E2E-125: a consultant adds notes and they show on the history, newest first, with the author", async ({
    page,
    apiAs,
    leadPage,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Có ghi chú ${testTag}` });

    await leadPage.goto(lead.id);
    await expect(leadPage.heading(lead.fullName)).toBeVisible();
    await leadPage.addNote("Khách muốn tập buổi sáng.");
    await expect(toasts(page).getByText(l.notes.saved)).toBeVisible();
    await leadPage.addNote("Đã gọi lại, hẹn thứ Bảy.");

    await expect(leadPage.history.first()).toContainText("Đã gọi lại, hẹn thứ Bảy.");
    await expect(leadPage.history.first()).toContainText(l.timeline.note);
    await expect(leadPage.history.first()).toContainText(E2E_USERS.CONSULTING.name);
    await expect(leadPage.history.filter({ hasText: "Khách muốn tập buổi sáng." })).toHaveCount(1);
  });

  test("an empty note is refused before anything is saved", async ({ apiAs, leadPage, testTag }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Ghi chú trống ${testTag}` });
    await leadPage.goto(lead.id);

    await leadPage.addNote("   ");

    await expect(leadPage.history.filter({ hasText: l.timeline.note })).toHaveCount(0);
  });
});
