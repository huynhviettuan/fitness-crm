import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

export type CustomerInput = { fullName: string; phone: string; email?: string; dateOfBirth?: string; branch?: string };

/** The "Add customer" / "Edit details" sheet. Every locator is scoped to the dialog. */
export class CustomerFormSheet {
  constructor(readonly root: Locator) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: CustomerInput): Promise<void> {
    const fields = labels.customers.fields;
    if (input.branch !== undefined) {
      // Asked only of users who work in more than one branch (D-014).
      await this.root.getByRole("combobox", { name: fields.branch, exact: true }).click();
      await this.root.page().getByRole("option", { name: input.branch, exact: true }).click();
    }
    await this.field(fields.fullName).fill(input.fullName);
    await this.field(fields.phone).fill(input.phone);
    if (input.email !== undefined) await this.field(fields.email).fill(input.email);
    if (input.dateOfBirth !== undefined) await this.field(fields.dateOfBirth).fill(input.dateOfBirth);
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}

export class CustomersPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/customers");
    await this.shell.pageHeading(labels.customers.title).waitFor();
  }

  get addButton(): Locator {
    return this.shell.main.getByRole("button", { name: labels.customers.create });
  }

  async openCreate(): Promise<CustomerFormSheet> {
    await this.addButton.click();
    return new CustomerFormSheet(this.page.getByRole("dialog", { name: labels.customers.create }));
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: labels.customers.title });
  }

  get exportButton(): Locator {
    return this.shell.main.getByRole("button", { name: labels.common.exportExcel, exact: true });
  }

  private get filters(): Locator {
    return this.shell.main.getByRole("complementary", { name: labels.customers.filters });
  }

  /** Chooses a filter's value, applies the filters, and waits for the page they lead to (`param` = `value` in the URL). */
  async filter(label: string, option: string, query: { param: string; value: string }): Promise<void> {
    await this.filters.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
    await this.filters.getByRole("button", { name: labels.customers.apply, exact: true }).click();
    await this.page.waitForURL((url) => url.searchParams.get(query.param) === query.value);
  }

  /** Types a day filter (dd/MM/yyyy) and applies the filters. */
  async filterDay(label: string, day: string, param: string): Promise<void> {
    await this.filters.getByLabel(label, { exact: true }).fill(day);
    await this.filters.getByRole("button", { name: labels.customers.apply, exact: true }).click();
    await this.page.waitForURL((url) => url.searchParams.get(param) === day);
  }

  row(text: string): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  async search(term: string): Promise<void> {
    const box = this.shell.main.getByRole("search").getByRole("searchbox");
    await box.fill(term);
    await box.press("Enter");
  }
}

export class CustomerDetailPage {
  private readonly shell: AppShell;

  constructor(page: Page) {
    this.shell = new AppShell(page);
  }

  heading(name: string): Locator {
    return this.shell.pageHeading(name);
  }

  async openTab(name: string): Promise<void> {
    await this.shell.main.getByRole("tab", { name, exact: true }).click();
  }

  /** The panel of an opened tab, to scope what the test reads in it. */
  tabPanel(name: string): Locator {
    return this.shell.main.getByRole("tabpanel", { name, exact: true });
  }

  /** The value (<dd>) shown under a label (<dt>) in the "Customer details" card. */
  detail(label: string): Locator {
    return this.shell.main
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }
}
