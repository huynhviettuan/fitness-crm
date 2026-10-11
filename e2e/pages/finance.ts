import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

const f = labels.finance.fields;

/** Chooses `optionText` in the select labelled `label`; the open listbox owns the options. */
async function choose(page: Page, root: Locator, label: string, optionText: string): Promise<void> {
  await root.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: optionText, exact: true }).click();
}

/** The "Record payment" dialog. */
export class PaymentDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async fill(input: { amount: string; method: string; methodNote?: string; paidOn?: string }): Promise<void> {
    await this.root.getByLabel(f.amount, { exact: true }).fill(input.amount);
    await choose(this.page, this.root, f.method, input.method);
    if (input.methodNote !== undefined)
      await this.root.getByLabel(labels.options.otherNote, { exact: true }).fill(input.methodNote);
    if (input.paidOn !== undefined) await this.root.getByLabel(f.paidOn, { exact: true }).fill(input.paidOn);
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
}

/** The "Record income or expense" dialog. */
export class CashDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async fill(input: { type: string; category: string; amount: string; reference?: string }): Promise<void> {
    await choose(this.page, this.root, f.type, input.type);
    // The category list follows the type (D-034).
    await choose(this.page, this.root, f.category, input.category);
    await this.root.getByLabel(f.amount, { exact: true }).fill(input.amount);
    if (input.reference) await this.root.getByLabel(f.reference, { exact: true }).fill(input.reference);
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
    await this.root.waitFor({ state: "hidden" });
  }
}

/** A table of payments or cash transactions, with the delete action. */
export class PaymentsTable {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  /** The rows containing every one of `texts`. */
  row(...texts: string[]): Locator {
    return texts.reduce((rows, text) => rows.filter({ hasText: text }), this.root.getByRole("row"));
  }

  deleteButton(...rowTexts: string[]): Locator {
    return this.row(...rowTexts).getByRole("button", { name: labels.finance.delete, exact: true });
  }

  /** Opens the delete dialog of a row. */
  async openDelete(...rowTexts: string[]): Promise<DeleteDialog> {
    await this.deleteButton(...rowTexts).click();
    return new DeleteDialog(this.page, this.page.getByRole("alertdialog"));
  }

  /** Deletes a row to the trash with `reason` from the list, and its note when there is one. */
  async delete(reason: { option: string; note?: string }, ...rowTexts: string[]): Promise<void> {
    const dialog = await this.openDelete(...rowTexts);
    await dialog.choose(reason.option, reason.note);
    await dialog.confirm();
  }
}

/** The delete confirmation, which asks for a reason from the list (D-035, D-016). */
export class DeleteDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async choose(option: string, note?: string): Promise<void> {
    await choose(this.page, this.root, labels.finance.deleteReason, option);
    if (note !== undefined) await this.root.getByLabel(labels.options.otherNote, { exact: true }).fill(note);
  }

  async confirm(): Promise<void> {
    await this.root.getByRole("button", { name: labels.finance.delete, exact: true }).click();
    await this.root.waitFor({ state: "hidden" });
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}

/** Finance: payments, debt, and income/expense tabs. */
export class FinancePage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(tab: "payments" | "debt" | "cash", month?: string): Promise<void> {
    await this.page.goto(`/finance/${tab}${month ? `?month=${month}` : ""}`);
  }

  get tabs(): Locator {
    return this.shell.main.getByRole("navigation", { name: labels.finance.title });
  }

  table(name: string): PaymentsTable {
    return new PaymentsTable(this.page, this.shell.main.getByRole("table", { name }));
  }

  /** A month total card on the income/expense tab. */
  total(label: string): Locator {
    return this.shell.main
      .getByRole("heading", { name: label, exact: true })
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
  }

  async openRecordCash(): Promise<CashDialog> {
    await this.shell.main.getByRole("button", { name: labels.finance.recordCash, exact: true }).click();
    return new CashDialog(this.page, this.page.getByRole("dialog", { name: labels.finance.recordCash }));
  }
}
