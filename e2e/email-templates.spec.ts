import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "./support/data";
import { fill, labels } from "./support/labels";

// The customer email templates and the email of a session change (brief §8.3; D-036; FR-MAIL-001, FR-MAIL-002; AC-17;
// docs/13 E2E-109's email part and E2E-113). The templates are shared by the whole system, so these tests edit an event
// no other spec reads (a missed session) and put it back afterwards.
const e = labels.emailTemplates;
const EVENT = "session.noShow";

type Template = { subjectVi: string; bodyVi: string; subjectEn: string; bodyEn: string };

test.describe("email templates as admin", () => {
  test.use(signedInAs("ADMIN"));

  let original: Template | null = null;

  test.beforeEach(async ({ apiAs }) => {
    const response = await (await apiAs("ADMIN")).get(`/api/v1/email-templates/${EVENT}`);
    original = (await response.json()) as Template;
  });

  test.afterEach(async ({ apiAs }) => {
    if (!original) return;
    const { subjectVi, bodyVi, subjectEn, bodyEn } = original;
    await (
      await apiAs("ADMIN")
    ).put(`/api/v1/email-templates/${EVENT}`, {
      data: { subjectVi, bodyVi, subjectEn, bodyEn },
    });
  });

  test("@smoke E2E-109: admin rewrites an email with a live preview, and the customer's next email says it", async ({
    page,
    apiAs,
    testTag,
    customerDetailPage,
  }) => {
    const { customer, refs } = await bookingSetup(apiAs, testTag);
    const day = randomBookingDay();
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
      date: day.date,
      startTime: "09:00",
      endTime: "10:00",
    });

    await page.goto("/admin/email-templates");
    await page.getByRole("link", { name: "Buổi tập tính vào hợp đồng khi khách không đến" }).click();
    await expect(page.getByRole("region", { name: e.placeholders })).toContainText("{remaining}");
    const vietnamese = page.getByRole("region", { name: e.languages.vi, exact: true });
    await vietnamese.getByLabel(e.subject, { exact: true }).fill(`Vắng buổi {day} ${testTag}`);
    await vietnamese
      .getByLabel(e.body, { exact: true })
      .fill("Chào {customerName}, còn {remaining} buổi, đã dùng {used}.");

    // The preview fills the placeholders with sample data as the admin types.
    const preview = page.getByRole("region", { name: fill(e.previewOf, { language: e.languages.vi }) });
    await expect(preview).toContainText(`Vắng buổi 20/10/2026 ${testTag}`);
    await expect(preview).toContainText("Chào Nguyễn Văn An, còn 14 buổi, đã dùng 10.");
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(e.saved)).toBeVisible();

    // The next missed session is emailed with the new words.
    const noShow = await (await apiAs("ADMIN")).post(`/api/v1/bookings/${booking.id}/no-show`);
    expect(noShow.status()).toBe(200);
    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.emails);
    const row = customerDetailPage
      .tabPanel(labels.customers.tabs.emails)
      .getByRole("row")
      .filter({ hasText: `Vắng buổi ${day.date} ${testTag}` });
    await expect(row).toHaveCount(1);
  });

  test("a placeholder the event does not offer, and a body that drops what must be told, are refused", async ({
    page,
  }) => {
    await page.goto(`/admin/email-templates/${EVENT}`);
    const vietnamese = page.getByRole("region", { name: e.languages.vi, exact: true });
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);

    await vietnamese.getByLabel(e.body, { exact: true }).fill("Chào {customerName} {className}");
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();

    await expect(vietnamese).toContainText(labels.validation.unknownPlaceholder);
    // Without the unknown one, the body still lacks what the customer must be told.
    await vietnamese.getByLabel(e.body, { exact: true }).fill("Chào {customerName}");
    await page.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(vietnamese).toContainText(labels.validation.missingPlaceholder);
    await expect(notice(e.saved)).toHaveCount(0);
  });

  test("the list marks the always-sent emails and says whether the words are the system's own", async ({ page }) => {
    await page.goto("/admin/email-templates");

    const list = page.getByRole("list", { name: e.title });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("listitem").filter({ hasText: e.mandatory })).toHaveCount(5);
    await expect(list.getByRole("listitem").filter({ hasText: "Hoàn lại buổi tập" })).toContainText(
      /Nội dung gốc|Sửa bởi/,
    );
  });
});

test.describe("email templates as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("reception cannot open the templates", async ({ page, apiAs }) => {
    await page.goto("/admin/email-templates");
    await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
    expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/email-templates")).status()).toBe(403);
  });
});
