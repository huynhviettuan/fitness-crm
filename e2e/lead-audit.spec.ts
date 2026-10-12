import { expect, signedInAs, test } from "./fixtures";
import { auditCard, managerAuditCard } from "./pages/lead-audit";
import { createLeadViaApi, uniquePhone } from "./support/data";
import { E2E_USERS, setFirstStep } from "./support/db";
import { fill, labels } from "./support/labels";
import { createOptionViaApi } from "./support/options";

// The automatic consulting audit (brief §4.1; FR-LEAD-011; A-081 to A-085; docs/13 E2E-132,
// E2E-133). The tables add up every lead of the shared database, so the specs look at the
// rows of the leads they make, which carry the test's tag. The spec that changes the global
// criteria is in lead-audit-criteria.branch.spec.ts.
const a = labels.leadAudit;

test.describe("as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-132: a late step puts the lead in 'Leads to check' and lowers its score on the lead's page", async ({
    apiAs,
    leadAuditPage,
    leadPage,
    page,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const prompt = await createLeadViaApi(reception, { fullName: `Đúng hạn ${testTag}`, phone: uniquePhone() });
    const slow = await createLeadViaApi(reception, { fullName: `Trễ hạn ${testTag}`, phone: uniquePhone() });
    await setFirstStep(prompt.id, "onTime");
    await setFirstStep(slow.id, "late");

    await leadAuditPage.goto();
    // The consultants' table lists the consultant of the shared branch, with the team last.
    await expect(leadAuditPage.consultantRow(E2E_USERS.CONSULTING.name)).toBeVisible();
    await expect(leadAuditPage.consultantRow(a.team)).toBeVisible();
    await page.goto(`/leads/audit?from=01/01/2020&pageSize=100`);
    // Both lack a need group, so both are to check; the slow one also has a late step.
    await expect(leadAuditPage.toCheckRow(slow.fullName)).toBeVisible();
    await expect(leadAuditPage.toCheckRow(prompt.fullName)).toBeVisible();
    await expect(leadAuditPage.toCheckRow(slow.fullName)).toContainText(labels.leadAudit.criteria.needGroup);
    await expect(leadAuditPage.toCheckRow(slow.fullName)).toContainText("33%");
    await expect(leadAuditPage.toCheckRow(prompt.fullName)).toContainText("67%");

    await leadAuditPage.toCheckRow(slow.fullName).getByRole("link", { name: slow.fullName }).click();
    await expect(leadPage.heading(slow.fullName)).toBeVisible();
    const card = auditCard(page);
    await expect(card).toContainText("33%");
    await expect(card.getByRole("listitem").filter({ hasText: "Tư vấn sản phẩm phù hợp" })).toContainText(
      a.tab.outcome.LATE,
    );
    await expect(card.getByRole("listitem").filter({ hasText: a.criteria.needGroup })).toContainText(a.tab.failed);
    await expect(card.getByRole("listitem").filter({ hasText: a.criteria.phone })).toContainText(a.tab.passed);
    await expect(card.getByRole("listitem").filter({ hasText: a.criteria.refuseReason })).toContainText(
      a.tab.notApplicable,
    );
  });

  test("a step not yet due counts for nothing", async ({ apiAs, leadPage, page, testTag }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Chưa tới hạn ${testTag}` });
    await setFirstStep(lead.id, "openAhead");

    await leadPage.goto(lead.id);

    const card = auditCard(page);
    await expect(card.getByText(a.tab.empty)).toBeVisible();
    await expect(card.getByRole("listitem").filter({ hasText: "Tư vấn sản phẩm phù hợp" })).toContainText(
      a.tab.outcome.none,
    );
  });

  test("the audit is on the menu, and the filters narrow the table", async ({
    apiAs,
    leadAuditPage,
    shell,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Tháng cũ ${testTag}` });
    await setFirstStep(lead.id, "late");

    await leadAuditPage.goto("?pageSize=100");
    await expect(shell.navLink(labels.nav.leadsAudit)).toBeVisible();
    await expect(leadAuditPage.toCheckRow(lead.fullName)).toBeVisible();
    // A period in the past holds none of today's leads.
    await leadAuditPage.goto("?from=01/01/2020&to=02/01/2020");
    await expect(leadAuditPage.toCheckRow(lead.fullName)).toHaveCount(0);
  });
});

test.describe("as a consultant", () => {
  test.use(signedInAs("CONSULTING"));

  test("E2E-133: the audit is for managers: no menu item, the page and a lead's audit card are refused", async ({
    apiAs,
    leadPage,
    page,
    shell,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Của tôi ${testTag}` });

    await page.goto("/leads/audit");
    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
    await expect(shell.navLink(labels.nav.leadsAudit)).toHaveCount(0);
    await leadPage.goto(lead.id);
    await expect(leadPage.heading(lead.fullName)).toBeVisible();
    await expect(auditCard(page)).toHaveCount(0);
  });
});

const m = a.manager;

test.describe("the manager audit", () => {
  test.describe("as a Fitness Manager", () => {
    test.use(signedInAs("FITNESS_MANAGER"));

    test("E2E-135: a manager fails a lead naming the criteria not met, then passes it; both grades are kept, the latest first", async ({
      apiAs,
      leadPage,
      page,
      testTag,
    }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), {
        fullName: `Được chấm ${testTag}`,
        phone: uniquePhone(),
      });
      const criterion = `Chưa hỏi mục tiêu ${testTag}`;
      await createOptionViaApi(await apiAs("ADMIN"), "auditFailReasons", criterion);
      const card = managerAuditCard(page);

      await leadPage.goto(lead.id);
      await expect(card.getByText(m.none)).toBeVisible();
      await card.getByRole("button", { name: m.grade }).click();
      const dialog = page.getByRole("dialog", { name: fill(m.gradeTitle, { name: lead.fullName }) });
      await dialog.getByRole("combobox", { name: m.resultLabel }).click();
      await page.getByRole("option", { name: m.result.FAIL, exact: true }).click();
      await dialog.getByRole("checkbox", { name: criterion }).check();
      await dialog.getByLabel(m.comment, { exact: true }).fill("Cần gọi lại khách.");
      await dialog.getByRole("button", { name: labels.common.save }).click();

      await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(m.saved)).toBeVisible();
      await expect(card).toContainText(m.result.FAIL);
      await expect(card).toContainText(criterion);
      await expect(card).toContainText("Cần gọi lại khách.");

      await card.getByRole("button", { name: m.gradeAgain }).click();
      await page
        .getByRole("dialog", { name: fill(m.gradeTitle, { name: lead.fullName }) })
        .getByRole("button", { name: labels.common.save })
        .click();
      await expect(card.getByRole("region", { name: m.earlier })).toBeVisible();
      // The latest grade (a Pass) is first; the Fail is among the earlier ones.
      await expect(card.getByText(m.result.PASS, { exact: true })).toHaveCount(1);
      await expect(card.getByRole("region", { name: m.earlier })).toContainText(m.result.FAIL);
    });

    test("a Fail without a criterion is refused before anything is saved", async ({
      apiAs,
      leadPage,
      page,
      testTag,
    }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), {
        fullName: `Thiếu tiêu chí ${testTag}`,
        phone: uniquePhone(),
      });
      await leadPage.goto(lead.id);
      await managerAuditCard(page).getByRole("button", { name: m.grade }).click();
      const dialog = page.getByRole("dialog", { name: fill(m.gradeTitle, { name: lead.fullName }) });

      await dialog.getByRole("combobox", { name: m.resultLabel }).click();
      await page.getByRole("option", { name: m.result.FAIL, exact: true }).click();
      await dialog.getByRole("button", { name: labels.common.save }).click();

      await expect(dialog.locator('[data-slot="field-error"]')).toBeVisible();
      await expect(dialog).toBeVisible();
    });

    test("the queue is on the audit page", async ({ leadAuditPage, page }) => {
      await leadAuditPage.goto();

      await expect(page.getByRole("heading", { level: 2, name: a.queue.title })).toBeVisible();
      await expect(page.getByRole("table", { name: a.queue.title })).toBeVisible();
    });
  });

  test.describe("as a consultant", () => {
    test.use(signedInAs("CONSULTING"));

    test("E2E-136: the consultant sees the grade and the criteria of their lead, and cannot grade", async ({
      apiAs,
      leadPage,
      page,
      testTag,
    }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), {
        fullName: `Của tư vấn ${testTag}`,
        phone: uniquePhone(),
      });
      const criterion = `Báo giá sai ${testTag}`;
      const id = await createOptionViaApi(await apiAs("ADMIN"), "auditFailReasons", criterion);
      const graded = await (
        await apiAs("FITNESS_MANAGER")
      ).post(`/api/v1/leads/${lead.id}/audits`, {
        data: { result: "FAIL", criterionIds: [id], comment: "Báo giá thiếu phụ phí" },
      });
      expect(graded.status()).toBe(201);

      await leadPage.goto(lead.id);

      const card = managerAuditCard(page);
      await expect(card).toContainText(m.result.FAIL);
      await expect(card).toContainText(criterion);
      await expect(card).toContainText("Báo giá thiếu phụ phí");
      await expect(card.getByRole("button", { name: m.grade })).toHaveCount(0);
      await expect(card.getByRole("button", { name: m.gradeAgain })).toHaveCount(0);
    });
  });
});
