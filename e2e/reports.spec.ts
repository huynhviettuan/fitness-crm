import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, gymToday, uniquePhone } from "./support/data";
import { labels } from "./support/labels";
import { otherOptionId } from "./support/options";
import { readDownload } from "./support/xlsx";

// The consulting dashboard and the lead analysis (brief §9, D-041; A-089 to A-094; docs/13
// E2E-137 to E2E-139). The reports add up every lead of the shared database, so the specs look
// at the structure and at the figures they can tell from their own leads, which carry the tag.
const d = labels.consultingReport;
const a = labels.leadAnalysis;

test.describe("as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-137: the dashboard shows the team's figures, the funnel, and each consultant's row, and exports to Excel", async ({
    apiAs,
    page,
    testTag,
  }) => {
    await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Có mặt ${testTag}`, phone: uniquePhone() });
    const today = gymToday().date;

    await page.goto(`/reports/consulting?from=${today}&to=${today}`);

    await expect(page.getByRole("heading", { level: 1, name: d.title })).toBeVisible();
    const kpis = page.getByRole("region", { name: d.kpis });
    for (const label of [
      d.fields.leads,
      d.fields.bookingRate,
      d.fields.showRate,
      d.fields.compliance,
      d.fields.firstResponse,
      d.fields.score,
    ]) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    // The funnel is a chart, and its figures are in the table below (A-094).
    await expect(page.getByRole("img", { name: d.funnel.chartLabel })).toBeVisible();
    const table = page.getByRole("table", { name: d.byConsultant });
    await expect(table.getByRole("row").filter({ hasText: d.team })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "E2E Tư vấn" })).toBeVisible();
    for (const header of [d.funnel.consulted, d.funnel.booked, d.funnel.showed, d.funnel.contracted, d.fields.recare]) {
      await expect(table.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(d.title);
    expect(file.rows.at(-1)?.[0]).toBe(d.team);
    expect(file.header.slice(0, 3)).toEqual([d.fields.consultant, d.fields.leads, d.funnel.consulted]);
  });

  test("a period with no leads shows no figures instead of zeros that look like results", async ({ page }) => {
    await page.goto("/reports/consulting?from=01/01/2020&to=02/01/2020");

    await expect(page.getByText(d.empty)).toBeVisible();
    await expect(page.getByRole("region", { name: d.kpis }).getByText(d.noData).first()).toBeVisible();
  });

  test("E2E-138: the lead analysis splits the leads by each dimension, lists the notes of Khác, and exports to Excel", async ({
    apiAs,
    page,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const other = await otherOptionId(reception, "leadChannels");
    const note = `Hội chợ ${testTag}`;
    const created = await reception.post("/api/v1/leads", {
      data: { fullName: `Kênh khác ${testTag}`, phone: uniquePhone(), channelId: other, channelNote: note },
    });
    expect(created.status()).toBe(201);
    const today = gymToday().date;

    await page.goto(`/reports/lead-analysis?from=${today}&to=${today}`);

    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    for (const dimension of Object.values(a.dimensions)) {
      await expect(page.getByRole("region", { name: dimension, exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("img", { name: a.chartLabel.replace("{dimension}", a.dimensions.channel) }),
    ).toBeVisible();
    const channels = page.getByRole("table", { name: a.dimensions.channel });
    await expect(channels.getByRole("row").filter({ hasText: `${note} (1)` })).toContainText(labels.options.other);

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(a.title);
    expect(JSON.stringify(file.rows)).toContain(note);
  });

  test("the filters narrow both reports, and the menu has them", async ({ page, shell }) => {
    await page.goto("/reports/consulting");
    await expect(shell.navLink(labels.nav.consultingReport)).toBeVisible();
    await expect(shell.navLink(labels.nav.leadAnalysis)).toBeVisible();

    await page.getByLabel(labels.reports.from, { exact: true }).fill("01/01/2020");
    await page.getByLabel(labels.reports.to, { exact: true }).fill("02/01/2020");
    await page.getByRole("button", { name: labels.reports.apply }).click();

    await expect(page).toHaveURL(/from=01%2F01%2F2020|from=01\/01\/2020/);
    await expect(page.getByText(d.empty)).toBeVisible();
  });
});

test.describe("as a consultant", () => {
  test.use(signedInAs("CONSULTING"));

  test("E2E-139: a consultant sees the dashboard of their own leads, with no export and no lead analysis", async ({
    apiAs,
    page,
    shell,
    testTag,
  }) => {
    await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Của tôi ${testTag}`, phone: uniquePhone() });
    const today = gymToday().date;

    await page.goto(`/reports/consulting?from=${today}&to=${today}`);

    await expect(page.getByRole("heading", { level: 1, name: d.title })).toBeVisible();
    await expect(shell.navLink(labels.nav.consultingReport)).toBeVisible();
    await expect(shell.navLink(labels.nav.leadAnalysis)).toHaveCount(0);
    await expect(page.getByRole("button", { name: labels.common.exportExcel })).toHaveCount(0);

    await page.goto("/reports/lead-analysis");
    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});

test.describe("as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("neither report is on the menu, and both are refused by URL", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.navLink(labels.nav.consultingReport)).toHaveCount(0);
    await expect(shell.navLink(labels.nav.leadAnalysis)).toHaveCount(0);

    for (const path of ["/reports/consulting", "/reports/lead-analysis"]) {
      await page.goto(path);
      await expect(shell.main.getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
    }
  });
});
