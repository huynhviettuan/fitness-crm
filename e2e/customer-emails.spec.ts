import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi } from "./support/data";
import { insertEmailRow } from "./support/db";
import { fill, labels } from "./support/labels";

// E2E-151: the customer's "Emails sent" tab (FR-MAIL-003, D-036). The sender, its retries, and the task for a
// failed email are covered by the API's integration tests (`apps/api/test/integration/mail.int.test.ts`).
const mail = labels.mail;

test.describe("the Emails sent tab", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-151: reception reads each email's status and why a failed one failed; a customer with none sees an empty tab", async ({
    apiAs,
    customerDetailPage,
    page,
    testTag,
  }) => {
    const api = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(api, testTag);
    const quiet = await createCustomerViaApi(api, `${testTag}-yen`);
    await insertEmailRow(customer.id, { subject: `Đã ghi nhận ${testTag}`, status: "SENT" });
    await insertEmailRow(customer.id, {
      subject: `Không đi được ${testTag}`,
      status: "FAILED",
      failure: "providerRejected",
    });
    await insertEmailRow(customer.id, { subject: `Đang chờ ${testTag}`, status: "QUEUED", attempts: 0 });

    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.emails);

    const panel = customerDetailPage.tabPanel(labels.customers.tabs.emails);
    const row = (subject: string) => panel.getByRole("row").filter({ hasText: subject });
    await expect(row(`Đã ghi nhận ${testTag}`)).toContainText(labels.status.email.SENT);
    await expect(row(`Đã ghi nhận ${testTag}`)).toContainText("khach@example.com");
    await expect(row(`Không đi được ${testTag}`)).toContainText(labels.status.email.FAILED);
    await expect(row(`Không đi được ${testTag}`)).toContainText(mail.failure.providerRejected);
    await expect(row(`Đang chờ ${testTag}`)).toContainText(labels.status.email.QUEUED);

    await page.goto(`/customers/${quiet.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.emails);
    await expect(customerDetailPage.tabPanel(labels.customers.tabs.emails)).toContainText(mail.empty);
  });

  test("E2E-186: reception opens an email to read what the customer was told, and sees when it was only recorded (A-317)", async ({
    apiAs,
    customerDetailPage,
    page,
    testTag,
  }) => {
    const api = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(api, testTag);
    const subject = `Buổi tập ${testTag}`;
    await insertEmailRow(customer.id, {
      subject,
      status: "SENT",
      body: `Chào anh/chị,
Bạn còn 9 buổi. ${testTag}`,
      providerMessageId: `log:${testTag}`,
    });

    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.emails);
    const panel = customerDetailPage.tabPanel(labels.customers.tabs.emails);
    const row = panel.getByRole("row").filter({ hasText: subject });
    await expect(row).toContainText(mail.recordedOnly);

    await row.getByRole("button", { name: fill(mail.viewLabel, { subject }) }).click();
    const dialog = page.getByRole("dialog", { name: subject });
    await expect(dialog).toContainText(`Bạn còn 9 buổi. ${testTag}`);
    await expect(dialog).toContainText("khach@example.com");
    await expect(dialog).toContainText(mail.recordedOnlyHint);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
