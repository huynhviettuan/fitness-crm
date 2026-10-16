import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

// The workout catalogs (brief §7.1, FR-WKO-001, D-033; docs/13 E2E-116): equipment, a tree of body areas, exercises that
// are Strength or Cardio, and plan stages. Every entry carries the test's tag in its name and its code.
const w = labels.workoutCatalog;

test.describe("the catalogs as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-116: admin builds an area tree, equipment and exercises, filters them, and retires one", async ({
    page,
    testTag,
    workoutCatalogPage: catalog,
  }) => {
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);
    const area = `Thân dưới ${testTag}`;
    const child = `Đùi ${testTag}`;
    const bar = `Barbell ${testTag}`;

    await catalog.goto("equipment");
    let dialog = await catalog.openAdd(w.titles.equipmentAdd);
    await dialog.getByLabel(w.fields.code, { exact: true }).fill(`bb-${testTag}`);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(bar);
    await catalog.save(dialog);
    await expect(notice(w.saved)).toBeVisible();
    // The code is kept in capitals.
    await expect(catalog.row(bar)).toContainText(`BB-${testTag}`.toUpperCase());

    await catalog.goto("areas");
    dialog = await catalog.openAdd(w.titles.areaAdd);
    await dialog.getByLabel(w.fields.code, { exact: true }).fill(`ar-${testTag}`);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(area);
    await catalog.save(dialog);
    dialog = await catalog.openAdd(w.titles.areaAdd);
    await dialog.getByLabel(w.fields.code, { exact: true }).fill(`ch-${testTag}`);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(child);
    await catalog.choose(dialog, w.fields.parent, area);
    await catalog.save(dialog);
    await expect(catalog.row(child)).toContainText("└");
    await expect(catalog.row(area)).toBeVisible();

    await catalog.goto("exercises");
    dialog = await catalog.openAdd(w.titles.exerciseAdd);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(`Squat ${testTag}`);
    await catalog.choose(dialog, w.fields.area, `${area} › ${child}`);
    await catalog.choose(dialog, w.fields.equipment, bar);
    await dialog.getByLabel(w.fields.videoUrl, { exact: true }).fill("https://video.example.test/squat");
    await catalog.save(dialog);
    dialog = await catalog.openAdd(w.titles.exerciseAdd);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(`Chạy bộ ${testTag}`);
    await catalog.choose(dialog, w.fields.kind, w.kinds.CARDIO);
    await catalog.choose(dialog, w.fields.area, area);
    await catalog.save(dialog);

    const query = encodeURIComponent(testTag);
    await page.goto(`/admin/workout-catalog?tab=exercises&q=${query}`);
    const strength = catalog.row(`Squat ${testTag}`);
    await expect(strength).toContainText(w.kinds.STRENGTH);
    await expect(strength).toContainText(`${area} › ${child}`);
    await expect(strength).toContainText(bar);
    await expect(strength.getByRole("link", { name: w.videoOpen })).toHaveAttribute("target", "_blank");
    await expect(strength.getByRole("link", { name: w.videoOpen })).toHaveAttribute("rel", /noopener/);
    await expect(catalog.row(`Chạy bộ ${testTag}`)).toContainText(w.kinds.CARDIO);

    // The filter by kind.
    await page.goto(`/admin/workout-catalog?tab=exercises&q=${query}&kind=CARDIO`);
    await expect(catalog.row(`Chạy bộ ${testTag}`)).toBeVisible();
    await expect(catalog.row(`Squat ${testTag}`)).toHaveCount(0);

    // An exercise made inactive leaves the list until inactive entries are shown.
    await page.goto(`/admin/workout-catalog?tab=exercises&q=${query}`);
    dialog = await catalog.openEdit(`Chạy bộ ${testTag}`, w.titles.exerciseEdit);
    await dialog.getByRole("switch", { name: w.fields.active }).click();
    await catalog.save(dialog);
    await expect(catalog.row(`Chạy bộ ${testTag}`)).toHaveCount(0);
    await page.goto(`/admin/workout-catalog?tab=exercises&q=${query}&inactive=1`);
    await expect(catalog.row(`Chạy bộ ${testTag}`)).toContainText(w.inactive);
  });

  test("a name that exists is refused in the dialog", async ({ page, testTag, workoutCatalogPage: catalog }) => {
    await catalog.goto("stages");
    let dialog = await catalog.openAdd(w.titles.stageAdd);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(`Rehab ${testTag}`);
    await catalog.save(dialog);

    dialog = await catalog.openAdd(w.titles.stageAdd);
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(`REHAB ${testTag}`);
    await dialog.getByRole("button", { name: labels.common.save, exact: true }).click();

    await expect(dialog).toContainText(labels.validation.duplicate);
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("who may see and keep the catalogs", () => {
  test.describe("a PT", () => {
    test.use(signedInAs("PT"));

    test("sees the catalogs but has nothing to add or edit", async ({ page, workoutCatalogPage: catalog }) => {
      await catalog.goto("equipment");
      await expect(catalog.addButton).toHaveCount(0);
      // The edit buttons, not rows whose text happens to contain the word: other tests name entries too.
      await expect(page.getByRole("main").getByRole("button", { name: new RegExp(`^${w.edit}`) })).toHaveCount(0);
    });
  });

  test.describe("reception", () => {
    test.use(signedInAs("RECEPTIONIST"));

    test("has no way into the catalogs", async ({ page, apiAs }) => {
      await page.goto("/admin/workout-catalog");
      await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
      expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/workout/areas")).status()).toBe(403);
    });
  });
});
