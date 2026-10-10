import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const f = labels.bookings.fields;

/** The add/reschedule booking dialog. Locators are scoped to it, or to the open listbox it owns. */
export class BookingFormDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  /** Searches the customer by `query` and picks the result showing `code`. */
  async pickCustomer(query: string, code: string): Promise<void> {
    await this.root.getByLabel(f.customer, { exact: true }).fill(query);
    await this.root.getByRole("option").filter({ hasText: code }).click();
  }

  async chooseContract(code: string): Promise<void> {
    await this.choose(f.contract, code);
  }

  async chooseTrainer(name: string): Promise<void> {
    await this.choose(f.trainer, name);
  }

  async fillSlot(slot: { date?: string; startTime?: string; endTime?: string }): Promise<void> {
    if (slot.date !== undefined) await this.root.getByLabel(f.date, { exact: true }).fill(slot.date);
    if (slot.startTime !== undefined) await this.root.getByLabel(f.startTime, { exact: true }).fill(slot.startTime);
    if (slot.endTime !== undefined) await this.root.getByLabel(f.endTime, { exact: true }).fill(slot.endTime);
  }

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  async cancel(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.cancel, exact: true }).click();
    await this.root.waitFor({ state: "hidden" });
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }

  private async choose(label: string, optionText: string): Promise<void> {
    await this.root.getByRole("combobox", { name: label, exact: true }).click();
    // The open listbox is rendered outside the dialog and owns the options.
    await this.page.getByRole("listbox").getByRole("option").filter({ hasText: optionText }).click();
  }
}

/** The booking details sheet and its actions. */
export class BookingSheet {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  action(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** Clicks an action, then confirms it in its confirmation dialog. */
  async confirm(name: string): Promise<Locator> {
    await this.action(name).click();
    const dialog = this.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name, exact: true }).click();
    return dialog;
  }

  /** Opens an action's confirmation dialog without confirming it. */
  async openConfirmation(name: string): Promise<Locator> {
    await this.action(name).click();
    return this.page.getByRole("alertdialog");
  }

  /** The value (<dd>) next to a label (<dt>). */
  detail(label: string): Locator {
    return this.root
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }

  async openReschedule(): Promise<BookingFormDialog> {
    await this.action(labels.bookings.reschedule).click();
    return new BookingFormDialog(this.page, this.page.getByRole("dialog", { name: labels.bookings.reschedule }));
  }

  /** Closes the sheet; the page behind it is hidden from assistive technology until then. */
  async close(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.close, exact: true }).click();
    await this.root.waitFor({ state: "hidden" });
  }
}

/** A table of bookings (sessions list, a customer's or a contract's bookings). */
export class BookingsTable {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  /** The rows containing every one of `texts`. */
  row(...texts: string[]): Locator {
    return texts.reduce((rows, text) => rows.filter({ hasText: text }), this.root.getByRole("row"));
  }

  async open(...rowTexts: string[]): Promise<BookingSheet> {
    await this.row(...rowTexts).getByRole("button", { name: labels.bookings.open }).click();
    return bookingSheet(this.page);
  }
}

export function bookingSheet(page: Page): BookingSheet {
  return new BookingSheet(page, page.getByRole("dialog").filter({ has: page.locator("dl") }));
}

export function bookingForm(page: Page, name: string = labels.bookings.create): BookingFormDialog {
  return new BookingFormDialog(page, page.getByRole("dialog", { name }));
}

/** The PT calendar (TrainerScheduleGrid). */
export class CalendarPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(day: string, trainerId?: string): Promise<void> {
    await this.page.goto(`/calendar?date=${day}${trainerId ? `&trainer=${trainerId}` : ""}`);
  }

  get columns(): Locator {
    return this.shell.main.getByRole("group");
  }

  column(trainerName: string): Locator {
    return this.shell.main.getByRole("group", { name: trainerName, exact: true });
  }

  block(trainerName: string, text: string): Locator {
    return this.column(trainerName).getByTestId("booking-block").filter({ hasText: text });
  }

  async openBlock(trainerName: string, text: string): Promise<BookingSheet> {
    await this.block(trainerName, text).click();
    return bookingSheet(this.page);
  }

  /** Clicks the empty slot of `trainerName` at `time` (HH:mm) and returns the create dialog. */
  async clickSlot(trainerName: string, time: string): Promise<BookingFormDialog> {
    await this.column(trainerName)
      .getByRole("button", { name: fill(labels.bookings.addAt, { trainer: trainerName, time }), exact: true })
      .click();
    return bookingForm(this.page);
  }

  async openAddBooking(): Promise<BookingFormDialog> {
    await this.shell.main.getByRole("button", { name: labels.bookings.create, exact: true }).click();
    return bookingForm(this.page);
  }
}

/** Session operations (docs/08 Screen 7). */
export class SessionsPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/sessions");
  }

  async showView(name: string): Promise<void> {
    await this.shell.main.getByRole("navigation").getByRole("link", { name, exact: true }).click();
  }

  table(viewName: string): BookingsTable {
    return new BookingsTable(this.page, this.shell.main.getByRole("table", { name: viewName }));
  }
}

/** The Bookings tab on a customer's page. */
export class CustomerBookingsTab {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async open(customerId: string): Promise<void> {
    await this.page.goto(`/customers/${customerId}`);
    await this.shell.main.getByRole("tab", { name: labels.customers.tabs.bookings }).click();
  }

  get panel(): Locator {
    return this.shell.main.getByRole("tabpanel", { name: labels.customers.tabs.bookings });
  }

  get table(): BookingsTable {
    return new BookingsTable(this.page, this.panel.getByRole("table", { name: labels.customers.tabs.bookings }));
  }

  async openAddBooking(): Promise<BookingFormDialog> {
    await this.panel.getByRole("button", { name: labels.bookings.create, exact: true }).click();
    return bookingForm(this.page);
  }
}

/** Trainer management. */
export class TrainersPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/trainers");
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: labels.trainers.title });
  }

  async add(fullName: string): Promise<void> {
    await this.shell.main.getByRole("button", { name: labels.trainers.create, exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: labels.trainers.create });
    await dialog.getByLabel(labels.trainers.fields.fullName, { exact: true }).fill(fullName);
    await dialog.getByRole("button", { name: labels.common.save }).click();
  }
}
