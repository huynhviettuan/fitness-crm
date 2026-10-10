import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

export type CustomerInput = { fullName: string; phone: string; email?: string; dateOfBirth?: string };

/** The "Add customer" / "Edit details" sheet. Every locator is scoped to the dialog. */
export class CustomerFormSheet {
  constructor(readonly root: Locator) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: CustomerInput): Promise<void> {
    const fields = labels.customers.fields;
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

  /** The value (<dd>) shown under a label (<dt>) in the "Customer details" card. */
  detail(label: string): Locator {
    return this.shell.main
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }
}
