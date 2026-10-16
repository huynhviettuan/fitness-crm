import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { gymDay } from "./support/data";
import { fill, labels } from "./support/labels";

// Services and price tiers (brief §5.1; FR-SVC-001 to FR-SVC-003; D-021, A-107, A-108; docs/13 E2E-152 to E2E-153).
// Services carry the test's tag; teardown removes them with their versions.
const s = labels.services;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("services as Admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-152: Admin adds a service, prices it in tiers, tries a count, and a new version waits for its day", async ({
    page,
    servicesPage,
    serviceDetailPage,
    testTag,
  }) => {
    const name = `Hybrid ${testTag}`;

    await servicesPage.goto();
    const dialog = await servicesPage.openCreate();
    await dialog.field(s.fields.name).fill(name);
    await dialog.field(s.fields.commissionRate).fill("30");
    await dialog.save();
    await expect(toasts(page).getByText(fill(s.created, { name }))).toBeVisible();
    await expect(serviceDetailPage.heading(name)).toBeVisible();
    await expect(page.getByText(s.tiers.empty)).toBeVisible();

    // The first version: three tiers with a gap between 23 and 36 sessions.
    const first = await serviceDetailPage.openNewVersion();
    await first.effectiveFrom.fill(gymDay(-30));
    await first.fillTier(1, { min: 1, max: 11, price: 700000, months: 1 });
    await first.addRow();
    await first.fillTier(2, { min: 12, max: 23, price: 650000, months: 2 });
    await first.addRow();
    await first.fillTier(3, { min: 36, max: null, price: 500000, months: 6 });
    await first.save();
    await expect(toasts(page).getByText(s.tiers.saved)).toBeVisible();
    const v1 = serviceDetailPage.version(1);
    await expect(v1).toContainText(s.tiers.inForce);
    await expect(v1).toContainText(fill(s.tiers.rangeClosed, { min: 12, max: 23 }));
    await expect(v1).toContainText(fill(s.tiers.rangeOpen, { min: 36 }));

    // Any count is looked up; a count between two tiers is refused.
    await serviceDetailPage.tryPrice(12, "15/10/2026");
    await expect(serviceDetailPage.lookup).toContainText(s.lookup.displayName);
    await expect(serviceDetailPage.lookup).toContainText(`${name} 12 buổi`);
    await expect(serviceDetailPage.lookup).toContainText("7.800.000");
    await expect(serviceDetailPage.lookup).toContainText("14/12/2026");
    await serviceDetailPage.tryPrice(24);
    await expect(serviceDetailPage.lookup.getByRole("alert")).toHaveText(labels.validation.noPriceTier);

    // A new version from tomorrow does not change what is in force today.
    const second = await serviceDetailPage.openNewVersion();
    await second.effectiveFrom.fill(gymDay(1));
    await second.cell("unitPrice", 1).fill("800000");
    await second.save();
    await expect(toasts(page).getByText(s.tiers.saved).first()).toBeVisible();
    await expect(serviceDetailPage.version(2)).toContainText(s.tiers.upcoming);
    await expect(serviceDetailPage.version(1)).toContainText(s.tiers.inForce);
    await serviceDetailPage.tryPrice(5);
    await expect(serviceDetailPage.lookup).toContainText("700.000");

    // The quick-pick counts.
    await serviceDetailPage.openTab(s.tabs.packages);
    const packages = await serviceDetailPage.openPackages();
    await packages.getByLabel(s.packages.sessions).fill("30, 12, 24");
    await packages.getByRole("button", { name: labels.common.save }).click();
    await expect(toasts(page).getByText(s.packages.saved)).toBeVisible();
    await expect(serviceDetailPage.packageBadge(12)).toBeVisible();
    await expect(serviceDetailPage.packageBadge(30)).toBeVisible();
  });

  test("E2E-153: the form refuses overlapping tiers, a past start day, and a name already used", async ({
    page,
    servicesPage,
    serviceDetailPage,
    testTag,
  }) => {
    const name = `Family ${testTag}`;
    await servicesPage.goto();
    const created = await servicesPage.openCreate();
    await created.field(s.fields.name).fill(name);
    await created.save();
    await expect(serviceDetailPage.heading(name)).toBeVisible();

    await servicesPage.goto();
    const again = await servicesPage.openCreate();
    await again.field(s.fields.name).fill(name.toLowerCase());
    await again.save();
    await expect(again.fieldErrors.filter({ hasText: labels.validation.nameTaken })).toBeVisible();
    await page.keyboard.press("Escape");

    await servicesPage.row(name).getByRole("link", { name }).click();
    const first = await serviceDetailPage.openNewVersion();
    await first.effectiveFrom.fill(gymDay(-3));
    await first.fillTier(1, { min: 1, max: 12, price: 100000, months: 1 });
    await first.addRow();
    await first.fillTier(2, { min: 12, max: 24, price: 90000, months: 2 });
    await first.save();
    await expect(first.fieldErrors.filter({ hasText: labels.validation.tiersOverlap })).toBeVisible();

    await first.cell("minSessions", 2).fill("13");
    await first.save();
    await expect(serviceDetailPage.version(1)).toBeVisible();

    const next = await serviceDetailPage.openNewVersion();
    await next.effectiveFrom.fill(gymDay(-1));
    await next.save();
    await expect(next.fieldErrors.filter({ hasText: labels.validation.effectiveInPast })).toBeVisible();
  });
});

test.describe("services as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-154: reception reads services and tries prices but has no button to change them", async ({
    apiAs,
    servicesPage,
    serviceDetailPage,
    testTag,
  }) => {
    const name = `Group ${testTag}`;
    const admin = await apiAs("ADMIN");
    const branchId = "b0000000-0000-4000-8000-000000000001";
    const created = await admin.post("/api/v1/services", { data: { name, kind: "CLASS", branchIds: [branchId] } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const priced = await admin.put(`/api/v1/services/${id}/tiers`, {
      data: {
        effectiveFrom: gymDay(-1),
        tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 200000, validityMonths: 3, validityDays: 0 }],
      },
    });
    expect(priced.status()).toBe(200);

    await servicesPage.goto();
    await expect(servicesPage.row(name)).toBeVisible();
    await expect(servicesPage.createButton).toHaveCount(0);
    await servicesPage.row(name).getByRole("link", { name }).click();
    await expect(serviceDetailPage.heading(name)).toBeVisible();
    await expect(serviceDetailPage.newVersionButton).toHaveCount(0);
    await serviceDetailPage.tryPrice(10);
    await expect(serviceDetailPage.lookup).toContainText("2.000.000");
  });
});
