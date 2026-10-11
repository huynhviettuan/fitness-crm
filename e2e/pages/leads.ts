import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const l = labels.leads;

/** The "Add lead" / "Edit details" sheet. Every locator is scoped to it. */
export class LeadFormSheet {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: { fullName: string; phone?: string; channel: string; channelNote?: string }): Promise<void> {
    await this.field(l.fields.fullName).fill(input.fullName);
    if (input.phone !== undefined) await this.field(l.fields.phone).fill(input.phone);
    await this.root.getByRole("combobox", { name: l.fields.channel, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: input.channel, exact: true }).click();
    if (input.channelNote !== undefined) await this.field(labels.options.otherNote).fill(input.channelNote);
  }

  async showMore(): Promise<void> {
    await this.root.getByRole("button", { name: l.moreDetails, exact: true }).click();
  }

  async choose(label: string, option: string): Promise<void> {
    await this.root.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  /** D-019: the notice naming the record that already has the phone (the alert with a link, not a field error). */
  get duplicate(): Locator {
    return this.root.getByRole("alert").filter({ has: this.page.getByRole("link") });
  }
}

/** Leads (FR-LEAD-006): the list and the quick intake form. */
export class LeadsPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/leads${query}`);
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: l.title });
  }

  row(text: string): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  get addButton(): Locator {
    return this.shell.main.getByRole("button", { name: l.create, exact: true });
  }

  async openAdd(): Promise<LeadFormSheet> {
    await this.addButton.click();
    return new LeadFormSheet(this.page, this.page.getByRole("dialog", { name: l.create }));
  }

  async open(fullName: string): Promise<void> {
    await this.table.getByRole("link", { name: fill(l.open, { name: fullName }), exact: true }).click();
  }
}

/** One lead's page. */
export class LeadPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/leads/${id}`);
  }

  heading(name: string): Locator {
    return this.shell.pageHeading(name);
  }

  /** A value (<dd>) in one of the page's cards; scoped, since a page left behind can stay in the DOM. */
  detail(card: string, label: string): Locator {
    return this.shell.main
      .getByRole("region", { name: card })
      .locator("dt")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]");
  }

  async openEdit(): Promise<LeadFormSheet> {
    await this.shell.main.getByRole("button", { name: l.edit, exact: true }).click();
    return new LeadFormSheet(this.page, this.page.getByRole("dialog", { name: l.edit }));
  }
}
