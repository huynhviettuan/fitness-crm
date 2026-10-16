import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { gymDay } from "./support/data";
import { fill, labels } from "./support/labels";

// Promotions, vouchers, and the discount a role may approve (brief §2, §5.1; FR-SVC-004, FR-PLT-002; A-110 to A-112;
// docs/13 E2E-155 to E2E-157). Promotions and roles carry the test's tag; teardown removes them.
const p = labels.promotions;
const s = labels.services;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });
const branchId = "b0000000-0000-4000-8000-000000000001";

test.describe("promotions as Admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-155: Admin adds a promotion and a voucher, they stack on a price, and a voucher code is unique", async ({
    apiAs,
    page,
    promotionsPage,
    serviceDetailPage,
    testTag,
  }) => {
    const promoName = `Tết ${testTag}`;
    const voucherName = `Bạn mới ${testTag}`;
    const code = `V${testTag.toUpperCase()}`;
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Gói ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const service = (await made.json()) as { id: string; name: string };
    await admin.put(`/api/v1/services/${service.id}/tiers`, {
      data: {
        effectiveFrom: gymDay(-1),
        tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 1000000, validityMonths: 3, validityDays: 0 }],
      },
    });

    await promotionsPage.goto();
    const promo = await promotionsPage.openCreate();
    await promo.field(p.fields.name).fill(promoName);
    await promo.field(p.fields.value).fill("10");
    await promo.save();
    await expect(toasts(page).getByText(fill(p.created, { name: promoName }))).toBeVisible();
    await expect(promotionsPage.row(promoName)).toContainText("10%");
    await expect(promotionsPage.row(promoName)).toContainText(p.allServices);

    const voucher = await promotionsPage.openCreate();
    await voucher.choose(p.fields.kind, p.kinds.VOUCHER);
    await voucher.field(p.fields.name).fill(voucherName);
    await voucher.field(p.fields.code).fill(code);
    await voucher.field(p.fields.value).fill("10");
    await voucher.save();
    await expect(promotionsPage.row(voucherName)).toContainText(code);

    const again = await promotionsPage.openCreate();
    await again.choose(p.fields.kind, p.kinds.VOUCHER);
    await again.field(p.fields.name).fill(`${voucherName} 2`);
    await again.field(p.fields.code).fill(code.toLowerCase());
    await again.field(p.fields.value).fill("5");
    await again.save();
    await expect(again.fieldErrors.filter({ hasText: labels.validation.codeTaken })).toBeVisible();
    await page.keyboard.press("Escape");

    // On the service: the promotion first, the voucher on what is left, then VAT.
    await page.goto(`/admin/services/${service.id}`);
    await serviceDetailPage.tryPrice(10, undefined, { promotion: promoName, voucher: code.toLowerCase(), vat: "8" });
    await expect(serviceDetailPage.lookup).toContainText("10.000.000");
    await expect(serviceDetailPage.lookup).toContainText("1.900.000");
    await expect(serviceDetailPage.lookup).toContainText(fill(s.lookup.discountPercent, { percent: 19 }));
    await expect(serviceDetailPage.lookup).toContainText("8.748.000");

    await serviceDetailPage.tryPrice(10, undefined, { promotion: promoName, voucher: "KHONGCO" });
    await expect(serviceDetailPage.lookup.getByRole("alert")).toHaveText(labels.validation.voucherNotValid);
  });

  test("E2E-156: Admin switches a promotion off; it can no longer be chosen on a price", async ({
    apiAs,
    page,
    promotionsPage,
    serviceDetailPage,
    testTag,
  }) => {
    const name = `Hè ${testTag}`;
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Gói ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const service = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${service.id}/tiers`, {
      data: {
        effectiveFrom: gymDay(-1),
        tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 1000000, validityMonths: 3, validityDays: 0 }],
      },
    });
    await admin.post("/api/v1/promotions", {
      data: {
        kind: "PROMOTION",
        name,
        discountType: "AMOUNT",
        value: "500000",
        validFrom: gymDay(-1),
        validTo: gymDay(30),
      },
    });

    await page.goto(`/admin/services/${service.id}`);
    await serviceDetailPage.tryPrice(10, undefined, { promotion: name });
    await expect(serviceDetailPage.lookup).toContainText("500.000");

    await promotionsPage.goto();
    const edit = await promotionsPage.openEdit(name);
    await edit.root.getByRole("switch", { name: p.fields.active }).click();
    await edit.save();
    await expect(toasts(page).getByText(fill(p.saved, { name }))).toBeVisible();
    await expect(promotionsPage.row(name)).toContainText(labels.status.option.INACTIVE);

    await page.goto(`/admin/services/${service.id}`);
    await expect(await serviceDetailPage.promotionOption(name)).toHaveCount(0);
  });

  test("E2E-157: Admin sets the discount a role may approve, and it is kept", async ({ apiAs, page, testTag }) => {
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/roles", {
      data: {
        name: `Trưởng nhóm ${testTag}`,
        permissions: ["customer.view"],
        dataScopes: Object.fromEntries(
          ["leads", "customers", "contracts", "schedule", "vouchers", "staff", "tasks"].map((key) => [key, "OWN"]),
        ),
        fieldMasks: [],
      },
    });
    const role = (await made.json()) as { id: string };

    await page.goto(`/admin/roles/${role.id}`);
    const field = page.getByLabel(labels.roles.fields.discountThresholdPct, { exact: true });
    await expect(field).toHaveValue("0");
    await field.fill("12,5");
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(toasts(page).getByText(labels.roles.saved)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(labels.roles.fields.discountThresholdPct, { exact: true })).toHaveValue("12.5");

    await page.getByLabel(labels.roles.fields.discountThresholdPct, { exact: true }).fill("101");
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(
      page.locator('[data-slot="field-error"]').filter({ hasText: labels.validation.invalidPercent }),
    ).toBeVisible();
  });
});

test.describe("promotions as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-158: reception chooses a promotion on a price but has no page to manage them and sees no voucher code", async ({
    apiAs,
    page,
    serviceDetailPage,
    testTag,
  }) => {
    const name = `Khai trương ${testTag}`;
    const admin = await apiAs("ADMIN");
    const made = await admin.post("/api/v1/services", {
      data: { name: `Gói ${testTag}`, kind: "PT", branchIds: [branchId] },
    });
    const service = (await made.json()) as { id: string };
    await admin.put(`/api/v1/services/${service.id}/tiers`, {
      data: {
        effectiveFrom: gymDay(-1),
        tiers: [{ minSessions: 1, maxSessions: 100, unitPrice: 1000000, validityMonths: 3, validityDays: 0 }],
      },
    });
    await admin.post("/api/v1/promotions", { data: { kind: "PROMOTION", name, discountType: "PERCENT", value: "20" } });

    await page.goto(`/admin/services/${service.id}`);
    await serviceDetailPage.tryPrice(5, undefined, { promotion: name });
    await expect(serviceDetailPage.lookup).toContainText("1.000.000");
    await expect(serviceDetailPage.lookup).toContainText("4.000.000");

    await page.goto("/admin/promotions");
    await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});
