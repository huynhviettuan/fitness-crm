import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";
import { BookingsTable, bookingForm, type BookingFormDialog } from "./bookings";
import { OTHER_OPTION_LABEL } from "../support/options";
import { PaymentDialog, PaymentsTable } from "./finance";

const form = labels.contracts.form;

/** The contract form page (FR-CON-001, FR-CON-002): the fields, and the price panel beside them. */
export class ContractFormPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  get main(): Locator {
    return this.shell.main;
  }

  field(label: string): Locator {
    return this.main.getByLabel(label, { exact: true });
  }

  async choose(label: string, option: string | RegExp): Promise<void> {
    await this.main.getByRole("combobox", { name: label, exact: true }).click();
    await this.page
      .getByRole("option", typeof option === "string" ? { name: option, exact: true } : { name: option })
      .click();
  }

  async chooseService(name: string): Promise<void> {
    await this.choose(form.service, name);
  }

  async setSessions(count: number | string): Promise<void> {
    await this.field(form.sessions).fill(String(count));
  }

  /** Names the salesperson on the first Sale row. */
  async chooseSalesperson(name: string, row = 1): Promise<void> {
    // The option shows the employee's code first.
    await this.choose(`${form.saleShares}: ${form.employee} ${row}`, new RegExp(name));
  }

  /** The panel that shows the price the API works out. */
  get panel(): Locator {
    return this.main.getByRole("region", { name: labels.contracts.panel.title });
  }

  get submit(): Locator {
    return this.main.getByRole("button", { name: form.submit, exact: true });
  }

  get save(): Locator {
    return this.main.getByRole("button", { name: form.save, exact: true });
  }

  get fieldErrors(): Locator {
    return this.main.locator('[data-slot="field-error"]');
  }
}

export class ContractDetailPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/contracts/${id}`);
  }

  heading(packageName: string): Locator {
    return this.shell.pageHeading(packageName);
  }

  /** The value (<dd>) next to a label (<dt>) in one of the contract's cards. */
  figure(label: string): Locator {
    // A page left behind by navigation stays in the document, hidden: only what is shown counts.
    return this.shell.main
      .locator("dt:visible")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }

  action(name: string): Locator {
    return this.shell.main.getByRole("button", { name, exact: true });
  }

  /** Rejecting or unapproving: the action, then a reason from its list ("Khác") with a note, then the same button. */
  async actWithReason(name: string, reasonLabel: string, note: string): Promise<void> {
    await this.action(name).click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: reasonLabel, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: OTHER_OPTION_LABEL, exact: true }).click();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill(note);
    await dialog.getByRole("button", { name, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  /** Deleting: the delete action, a reason ("Khác") with a note, and the dialog's own delete button. */
  async deleteWithReason(note: string): Promise<void> {
    await this.action(labels.contracts.delete).click();
    const dialog = this.page.getByRole("alertdialog");
    await dialog.getByRole("combobox", { name: labels.finance.deleteReason, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: OTHER_OPTION_LABEL, exact: true }).click();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill(note);
    await dialog.getByRole("button", { name: labels.finance.delete, exact: true }).click();
  }

  /** Clicks an action, then confirms it in its confirmation dialog. */
  async confirmAction(name: string): Promise<void> {
    await this.action(name).click();
    await this.page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click();
  }

  get sessionHistory(): Locator {
    return this.shell.main.getByRole("region", { name: labels.contracts.sessionHistory });
  }

  get bookings(): BookingsTable {
    return new BookingsTable(
      this.page,
      this.sessionHistory.getByRole("table", { name: labels.contracts.sessionHistory }),
    );
  }

  get paymentHistory(): Locator {
    return this.shell.main.getByRole("region", { name: labels.contracts.paymentHistory });
  }

  get payments(): PaymentsTable {
    return new PaymentsTable(
      this.page,
      this.paymentHistory.getByRole("table", { name: labels.contracts.paymentHistory }),
    );
  }

  async openRecordPayment(): Promise<PaymentDialog> {
    await this.paymentHistory.getByRole("button", { name: labels.finance.recordPayment, exact: true }).click();
    return new PaymentDialog(this.page, this.page.getByRole("dialog", { name: labels.finance.recordPayment }));
  }

  async openAddBooking(): Promise<BookingFormDialog> {
    await this.sessionHistory.getByRole("button", { name: labels.bookings.create, exact: true }).click();
    return bookingForm(this.page);
  }
}

/** The Contracts tab on a customer's page. */
export class CustomerContractsTab {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async open(customerId: string): Promise<void> {
    await this.page.goto(`/customers/${customerId}`);
    await this.shell.main.getByRole("tab", { name: labels.customers.tabs.contracts }).click();
  }

  get panel(): Locator {
    return this.shell.main.getByRole("tabpanel", { name: labels.customers.tabs.contracts });
  }

  get createButton(): Locator {
    return this.panel.getByRole("link", { name: labels.contracts.create });
  }

  async openCreate(): Promise<ContractFormPage> {
    await this.createButton.click();
    await this.shell.pageHeading(labels.contracts.create).waitFor();
    return new ContractFormPage(this.page);
  }

  get table(): Locator {
    return this.panel.getByRole("table", { name: labels.contracts.title });
  }
}
