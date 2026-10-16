import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

const p = labels.promotions;

/** The promotions and vouchers admin page (FR-SVC-004, A-110). */
export class PromotionsPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/promotions");
    await this.shell.pageHeading(p.title).waitFor();
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: p.title });
  }

  row(name: string): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get createButton(): Locator {
    return this.shell.main.getByRole("button", { name: p.create });
  }

  async openCreate(): Promise<PromotionDialog> {
    await this.createButton.click();
    return new PromotionDialog(this.page.getByRole("dialog", { name: p.create }), this.page);
  }

  async openEdit(name: string): Promise<PromotionDialog> {
    await this.row(name)
      .getByRole("button", { name: p.rowActions.replace("{name}", name) })
      .click();
    return new PromotionDialog(this.page.getByRole("dialog", { name: p.edit }), this.page);
  }
}

/** The "Add promotion or voucher" / "Edit" dialog. */
export class PromotionDialog {
  constructor(
    readonly root: Locator,
    private readonly page: Page,
  ) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async choose(label: string, option: string): Promise<void> {
    await this.root.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("option", { name: option, exact: true }).click();
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}
