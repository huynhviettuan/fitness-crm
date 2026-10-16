import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import type { OptionListKey } from "../support/options";
import { AppShell } from "./app-shell";

const o = labels.options;

/** Administration → Option lists (FR-PLT-005): one list, its options, and the "Khác" notes. */
export class OptionListsPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(listKey: OptionListKey): Promise<void> {
    await this.page.goto(`/admin/options?list=${listKey}`);
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: o.lists[this.listKeyFromUrl()] });
  }

  get otherNotes(): Locator {
    return this.shell.main.getByRole("table", { name: o.otherNotes.title });
  }

  row(labelVi: string): Locator {
    return this.table.getByRole("row").filter({ hasText: labelVi });
  }

  async create(labelVi: string, labelEn: string): Promise<void> {
    await this.shell.main.getByRole("button", { name: o.create, exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: o.create });
    await dialog.getByLabel(o.fields.labelVi, { exact: true }).fill(labelVi);
    await dialog.getByLabel(o.fields.labelEn, { exact: true }).fill(labelEn);
    await dialog.getByRole("button", { name: labels.common.save }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  async setActive(labelVi: string, active: boolean): Promise<void> {
    await this.table.getByRole("button", { name: fill(o.rowActions, { name: labelVi }), exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: o.edit });
    await dialog.getByRole("switch", { name: o.fields.active }).setChecked(active);
    await dialog.getByRole("button", { name: labels.common.save }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  async moveUp(labelVi: string): Promise<void> {
    await this.table.getByRole("button", { name: fill(o.moveUp, { name: labelVi }), exact: true }).click();
  }

  /** The Vietnamese labels in the order shown. */
  async labelsInOrder(): Promise<string[]> {
    return this.table.getByRole("row").locator("td:nth-child(2)").allInnerTexts();
  }

  private listKeyFromUrl(): OptionListKey {
    return (new URL(this.page.url()).searchParams.get("list") ?? "paymentMethods") as OptionListKey;
  }
}

/** Administration → System parameters (FR-PLT-006). */
export class ParametersPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/parameters");
  }

  field(name: keyof typeof labels.parameters.fields): Locator {
    return this.shell.main.getByLabel(labels.parameters.fields[name], { exact: true });
  }

  async save(): Promise<void> {
    await this.shell.main.getByRole("button", { name: labels.common.save, exact: true }).click();
  }
}
