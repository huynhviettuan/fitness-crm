import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, recordPaymentViaApi } from "./support/data";
import { labels } from "./support/labels";

// Private pictures (T-052, M4.1b; docs/13 E2E-166): the service picture and the transfer proof of a receipt, shown
// through signed links. The security side is in security/files.spec.ts.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const picture = { name: "anh.png", mimeType: "image/png", buffer: PNG };

test.describe("as an Admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-166: Admin adds a picture to a service, sees it through a signed link, and removes it", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { items } = (await (await admin.get("/api/v1/branches")).json()) as {
      items: { id: string; active: boolean }[];
    };
    const made = await admin.post("/api/v1/services", {
      data: { name: `Gói ảnh ${testTag}`, kind: "MEMBER", branchIds: [items.find((branch) => branch.active)!.id] },
    });
    const service = (await made.json()) as { id: string; name: string };

    await page.goto(`/admin/services/${service.id}`);
    await page.getByRole("tab", { name: labels.services.tabs.info, exact: true }).click();
    await expect(page.getByText(labels.files.none)).toBeVisible();
    await page.getByLabel(labels.files.choose, { exact: true }).setInputFiles(picture);

    const image = page.getByRole("img", { name: service.name });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute(
      "src",
      /\/api\/v1\/files\/[0-9a-f-]+\/content\?expires=\d+&signature=[0-9a-f]{64}/,
    );
    await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);

    await page.getByRole("button", { name: labels.files.remove }).click();
    await expect(page.getByText(labels.files.none)).toBeVisible();
  });
});

test.describe("as a Receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("a receipt takes a transfer proof picture, and it is shown from the receipt", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(
      await apiAs("FITNESS_MANAGER"),
      (await createCustomerViaApi(reception, testTag)).id,
      { activateWith: await apiAs("ADMIN") },
    );
    const payment = await recordPaymentViaApi(reception, contract.id, "2.000.000", {
      approver: await apiAs("FITNESS_MANAGER"),
    });

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.payments
      .row(payment.receiptNumber)
      .getByRole("button", { name: labels.finance.proofAdd })
      .click();
    const dialog = page.getByRole("dialog", { name: fillTitle(payment.receiptNumber) });
    await dialog.getByLabel(labels.files.choose, { exact: true }).setInputFiles(picture);
    await expect(dialog.getByRole("img")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(
      contractDetailPage.payments.row(payment.receiptNumber).getByRole("button", { name: labels.finance.proofView }),
    ).toBeVisible();
  });
});

function fillTitle(number: string): string {
  return labels.finance.proofTitle.replace("{number}", number);
}
