// M1 slice 3: option lists (D-016) and system parameters (T-049).
import { randomUUID } from "node:crypto";
import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, createTrainerViaApi, gymToday } from "./support/data";
import { fill, labels } from "./support/labels";
import { OTHER_OPTION_LABEL, createOptionViaApi, otherOptionId } from "./support/options";

const fin = labels.finance;

test.describe("configuration", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-103/AC-03: an option added on screen is offered at once; switched off, it stays on old payments and is no longer offered", async ({
    page,
    apiAs,
    testTag,
    optionListsPage,
    contractDetailPage,
  }) => {
    const method = `Ví ${testTag}`;
    const contract = await createContractViaApi(
      await apiAs("FITNESS_MANAGER"),
      (await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag)).id,
      {
        activateWith: await apiAs("ADMIN"),
      },
    );

    await optionListsPage.goto("paymentMethods");
    await optionListsPage.create(method, `Wallet ${testTag}`);
    await expect(optionListsPage.row(method)).toContainText(labels.status.option.ACTIVE);

    await contractDetailPage.goto(contract.id);
    const dialog = await contractDetailPage.openRecordPayment();
    await dialog.fill({ amount: "1.000.000", method });
    await dialog.save();
    await expect(contractDetailPage.payments.row("1.000.000")).toContainText(method);

    await optionListsPage.goto("paymentMethods");
    await optionListsPage.setActive(method, false);
    await expect(optionListsPage.row(method)).toContainText(labels.status.option.INACTIVE);

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.payments.row("1.000.000")).toContainText(method);
    const again = await contractDetailPage.openRecordPayment();
    await again.root.getByRole("combobox", { name: fin.fields.method, exact: true }).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: OTHER_OPTION_LABEL, exact: true })).toBeVisible();
    await expect(listbox.getByRole("option", { name: method, exact: true })).toHaveCount(0);
  });

  test("an admin moves an option up; Khác stays last (FR-PLT-005)", async ({
    page,
    apiAs,
    testTag,
    optionListsPage,
  }) => {
    const admin = await apiAs("ADMIN");
    const first = `Lý do A ${testTag}`;
    const second = `Lý do B ${testTag}`;
    await createOptionViaApi(admin, "deleteReasons", first);
    await createOptionViaApi(admin, "deleteReasons", second);

    await optionListsPage.goto("deleteReasons");
    await optionListsPage.moveUp(second);
    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(labels.options.reordered),
    ).toBeVisible();

    await expect(async () => {
      const order = await optionListsPage.labelsInOrder();
      expect(order.indexOf(second)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
      expect(order.at(-1)).toContain(OTHER_OPTION_LABEL);
    }).toPass();
  });

  test("notes written with Khác are listed for admin to promote (FR-PLT-005)", async ({
    apiAs,
    testTag,
    optionListsPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(
      await apiAs("FITNESS_MANAGER"),
      (await createCustomerViaApi(reception, testTag)).id,
      { activateWith: await apiAs("ADMIN") },
    );
    const note = `Séc ${testTag}`;
    const response = await reception.post(`/api/v1/contracts/${contract.id}/payments`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        amount: "1.000.000",
        methodId: await otherOptionId(reception, "paymentMethods"),
        methodNote: note,
        paidOn: gymToday().date,
      },
    });
    // Receipts wait for approval (D-018); the note counts either way.
    expect(response.status()).toBe(202);

    await optionListsPage.goto("paymentMethods");

    await expect(optionListsPage.otherNotes.getByRole("row").filter({ hasText: note })).toContainText("1");
  });

  test("AC-02: an admin moves the end of the PT calendar, and the calendar follows at once (D-030, T-049)", async ({
    page,
    apiAs,
    testTag,
    restoresParameters,
    parametersPage,
    calendarPage,
  }) => {
    void restoresParameters;
    const trainer = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), testTag);
    const slot22 = calendarPage.column(trainer.fullName).getByRole("button", {
      name: fill(labels.bookings.addAt, { trainer: trainer.fullName, time: "22:00" }),
      exact: true,
    });

    await parametersPage.goto();
    await parametersPage.field("calendarDayEnd").fill("22:15");
    await parametersPage.save();
    await expect(parametersPage.field("calendarDayEnd")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(labels.validation.notOnHalfHour)).toBeVisible();

    await parametersPage.field("calendarDayEnd").fill("22:30");
    await parametersPage.save();
    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(labels.parameters.saved),
    ).toBeVisible();

    await calendarPage.goto(gymToday().url);
    await expect(slot22).toBeVisible();
  });
});
