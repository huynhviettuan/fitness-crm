import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const s = labels.scripts;

/** The script library admin page (FR-LEAD-010, A-072). */
export class ScriptsAdminPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/scripts");
    await this.shell.pageHeading(s.title).waitFor();
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: s.title });
  }

  row(situation: string): Locator {
    return this.table.getByRole("row").filter({ hasText: situation });
  }

  async openCreate(): Promise<ScriptDialog> {
    await this.shell.main.getByRole("button", { name: s.create }).click();
    return new ScriptDialog(this.page.getByRole("dialog", { name: s.create }));
  }

  async openEdit(situation: string): Promise<ScriptDialog> {
    await this.row(situation)
      .getByRole("button", { name: fill(s.rowActions, { name: situation }) })
      .click();
    return new ScriptDialog(this.page.getByRole("dialog", { name: s.edit }));
  }

  moveDown(situation: string): Locator {
    return this.row(situation).getByRole("button", { name: fill(s.moveDown, { name: situation }) });
  }

  moveUp(situation: string): Locator {
    return this.row(situation).getByRole("button", { name: fill(s.moveUp, { name: situation }) });
  }

  /** The situations in table order. */
  async situations(): Promise<string[]> {
    return this.table.getByRole("row").locator("td:nth-child(2)").allTextContents();
  }
}

/** The "Add script" / "Edit script" dialog. */
export class ScriptDialog {
  constructor(readonly root: Locator) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: { situationVi: string; situationEn: string; answerVi?: string; answerEn?: string }) {
    await this.field(s.fields.situationVi).fill(input.situationVi);
    await this.field(s.fields.situationEn).fill(input.situationEn);
    if (input.answerVi !== undefined) await this.field(s.fields.answerVi).fill(input.answerVi);
    if (input.answerEn !== undefined) await this.field(s.fields.answerEn).fill(input.answerEn);
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}
