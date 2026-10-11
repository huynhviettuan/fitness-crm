import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";
import { BookingsTable, bookingForm, type BookingFormDialog } from "./bookings";
import { PaymentDialog, PaymentsTable } from "./finance";

export type ContractInput = {
  packageName: string;
  contractValue: string;
  totalSessions: string;
  startDate: string;
  endDate: string;
};

/** The "Add contract" sheet. Every locator is scoped to the dialog. */
export class ContractFormSheet {
  constructor(readonly root: Locator) {}

  async fill(input: ContractInput): Promise<void> {
    const fields = labels.contracts.fields;
    for (const [key, label] of [
      ["packageName", fields.packageName],
      ["contractValue", fields.contractValue],
      ["totalSessions", fields.totalSessions],
      ["startDate", fields.startDate],
      ["endDate", fields.endDate],
    ] as const) {
      await this.root.getByLabel(label, { exact: true }).fill(input[key]);
    }
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
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
    return this.shell.main
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }

  action(name: string): Locator {
    return this.shell.main.getByRole("button", { name, exact: true });
  }

  /** Clicks an action, then confirms it in its confirmation dialog. */
  async confirmAction(name: string): Promise<void> {
    await this.action(name).click();
    await this.page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click();
  }

  get fieldErrors(): Locator {
    return this.page.getByRole("dialog").locator('[data-slot="field-error"]');
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
    return this.panel.getByRole("button", { name: labels.contracts.create });
  }

  async openCreate(): Promise<ContractFormSheet> {
    await this.createButton.click();
    return new ContractFormSheet(this.page.getByRole("dialog", { name: labels.contracts.create }));
  }

  get table(): Locator {
    return this.panel.getByRole("table", { name: labels.contracts.title });
  }
}
