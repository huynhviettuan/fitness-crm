// M1 slice 5: approvals (D-018, AC-05, E2E-113).
import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, recordPaymentViaApi } from "./support/data";
import { labels } from "./support/labels";
import { OTHER_OPTION_LABEL } from "./support/options";

const a = labels.approvals;
const cf = labels.contracts.fields;

test.describe("approvals as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-113: a receipt waits in the inbox, counts once approved, and nobody approves their own", async ({
    page,
    apiAs,
    testTag,
    approvalsPage,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(reception, testTag);
    const contract = await createContractViaApi(manager, customer.id, { activateWith: await apiAs("ADMIN") });
    const title = `${contract.contractCode} · ${customer.fullName}`;
    await recordPaymentViaApi(reception, contract.id, "2.000.000");
    // The manager's own receipt is not theirs to approve.
    await recordPaymentViaApi(manager, contract.id, "1.000.000");

    await approvalsPage.goto("toDecide");
    const rows = approvalsPage.row(title);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(a.actions.payment_create);
    await expect(rows).toContainText("2.000.000");
    await approvalsPage.approve(title);
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(a.approved)).toBeVisible();
    await expect(approvalsPage.row(title)).toHaveCount(0);

    await approvalsPage.goto("mine");
    // The contract's own approval is in the list too: this is the receipt's.
    const receipt = approvalsPage.row(title).filter({ hasText: a.actions.payment_create });
    await expect(receipt).toContainText(labels.status.approval.PENDING);
    await expect(approvalsPage.approveButton(title)).toHaveCount(0);

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(cf.paidAmount)).toHaveText(/2\.000\.000/);
  });

  test("a rejection takes a reason, and the submitter sees it", async ({ apiAs, testTag, approvalsPage }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: await apiAs("ADMIN"),
    });
    const title = `${contract.contractCode} · ${customer.fullName}`;
    await recordPaymentViaApi(reception, contract.id, "3.000.000");

    await approvalsPage.goto("toDecide");
    await approvalsPage.reject(title, `Sai số tiền ${testTag}`, OTHER_OPTION_LABEL);

    const mine = (await (await reception.get("/api/v1/approvals?view=mine&pageSize=100")).json()) as {
      items: { title: string; status: string; rejectReason: { note: string } | null }[];
    };
    expect(mine.items.find((item) => item.title === title)).toMatchObject({
      status: "REJECTED",
      rejectReason: { note: `Sai số tiền ${testTag}` },
    });
  });
});

test.describe("the approval matrix as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("AC-05: an admin changes the approvers of an action on screen, and it applies at once", async ({
    apiAs,
    testTag,
    restoresApprovalRules,
    approvalRulesPage,
    approvalsPage,
  }) => {
    void restoresApprovalRules;
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const response = await reception.patch(`/api/v1/customers/${customer.id}`, {
      data: { fullName: customer.fullName, phone: "0909 888 777" },
    });
    expect(response.status()).toBe(202);
    const title = `${customer.customerCode} · ${customer.fullName}`;
    const action = a.actions.customer_identity;

    // Initially a Fitness Manager approves identity changes, not an admin.
    await approvalsPage.goto("toDecide");
    await expect(approvalsPage.row(title)).toHaveCount(0);

    await approvalRulesPage.goto();
    const adminRole = await (await (await apiAs("ADMIN")).get("/api/v1/roles")).json();
    const adminName = (adminRole.items as { code: string | null; name: string }[]).find(
      (role) => role.code === "ADMIN",
    )!.name;
    await approvalRulesPage.setApprover(action, adminName, true);
    await expect(approvalRulesPage.row(action)).toContainText(adminName);

    await approvalsPage.goto("toDecide");
    await expect(approvalsPage.row(title)).toContainText("0909888777");
    await approvalsPage.approve(title);
    const updated = await (await reception.get(`/api/v1/customers/${customer.id}`)).json();
    expect(updated).toMatchObject({ phone: "0909888777", pendingIdentity: null });
  });
});
