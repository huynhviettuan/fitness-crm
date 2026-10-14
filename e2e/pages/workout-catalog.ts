import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const w = labels.workoutCatalog;

/** The workout catalogs (M7.1): the four tabs, a row of each, and the dialog that adds and edits an entry. */
export class WorkoutCatalogPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(tab: "exercises" | "areas" | "equipment" | "stages" = "exercises", inactive = false): Promise<void> {
    await this.page.goto(`/admin/workout-catalog?tab=${tab}${inactive ? "&inactive=1" : ""}`);
  }

  /** A row of the open tab that mentions `text`. */
  row(text: string): Locator {
    return this.shell.main.getByRole("row").filter({ hasText: text });
  }

  get addButton(): Locator {
    return this.shell.main.getByRole("button", { name: w.add, exact: true });
  }

  /** Opens the dialog to add an entry; `title` is its heading. */
  async openAdd(title: string): Promise<Locator> {
    await this.addButton.click();
    return this.page.getByRole("dialog", { name: title });
  }

  /** Opens the dialog of the entry named `name` (the row button is named after the entry). */
  async openEdit(name: string, title: string): Promise<Locator> {
    await this.row(name)
      .getByRole("button", { name: fill(w.rowActions, { name }) })
      .click();
    return this.page.getByRole("dialog", { name: title });
  }

  /** Chooses an option of a select in the dialog. */
  async choose(dialog: Locator, label: string, option: string): Promise<void> {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  }

  async save(dialog: Locator): Promise<void> {
    await dialog.getByRole("button", { name: labels.common.save, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}
