import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";
import { openCompleteStep, type CompleteStepDialog } from "./checklist";

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

/** "Change status" (D-020): only the moves allowed from the lead's status are offered. Scoped to the dialog. */
export class ChangeStatusDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async choose(label: string, option: string): Promise<void> {
    await this.root.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  }

  async status(status: string): Promise<void> {
    await this.choose(l.newStatus, status);
  }

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: l.saveStatus, exact: true }).click();
  }
}

/** Reassigning a lead (BR-203). Scoped to the dialog. */
export class AssignLeadDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async choose(name: string): Promise<void> {
    await this.root.getByRole("combobox", { name: l.fields.pic, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: l.saveAssignment, exact: true }).click();
  }
}

/** Leads (FR-LEAD-006): the list, the Kanban board, and the quick intake form. */
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

  get board(): Locator {
    return this.shell.main.getByRole("region", { name: l.board });
  }

  /** A Kanban column by its status label. */
  column(status: string): Locator {
    return this.board.getByRole("region", { name: fill(l.statusColumn, { status }) });
  }

  async showBoard(): Promise<void> {
    await this.shell.main.getByRole("navigation", { name: l.views }).getByRole("link", { name: l.boardView }).click();
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

  private get journey(): Locator {
    return this.shell.main.getByRole("region", { name: l.journey });
  }

  private get checklist(): Locator {
    return this.shell.main.getByRole("region", { name: l.checklist });
  }

  /** One step of the consulting checklist (FR-LEAD-004), by its name. */
  checklistStep(name: string): Locator {
    return this.checklist.getByRole("listitem").filter({ has: this.page.getByText(name, { exact: true }) });
  }

  async completeStep(name: string): Promise<CompleteStepDialog> {
    return openCompleteStep(this.page, this.checklistStep(name), name);
  }

  /** The status change and assignment history, newest first (D-020). */
  get history(): Locator {
    return this.shell.main.getByRole("region", { name: l.history }).getByRole("listitem");
  }

  async openChangeStatus(name: string): Promise<ChangeStatusDialog> {
    await this.journey.getByRole("button", { name: l.changeStatus, exact: true }).click();
    return new ChangeStatusDialog(
      this.page,
      this.page.getByRole("dialog", { name: fill(l.changeStatusTitle, { name }) }),
    );
  }

  async openAssign(name: string, button: string = l.reassign): Promise<AssignLeadDialog> {
    await this.journey.getByRole("button", { name: button, exact: true }).click();
    return new AssignLeadDialog(this.page, this.page.getByRole("dialog", { name: fill(l.assignTitle, { name }) }));
  }
}
