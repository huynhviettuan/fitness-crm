import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

/** Administration → Trash (FR-TRASH-002). */
export class TrashPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(filters: { type?: string } = {}): Promise<void> {
    await this.page.goto(`/admin/trash${filters.type ? `?type=${filters.type}` : ""}`);
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: labels.trash.title });
  }

  row(text: string): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  /** Opens the deleted record as it was. */
  async view(title: string): Promise<Locator> {
    await this.table.getByRole("button", { name: fill(labels.trash.viewLabel, { name: title }), exact: true }).click();
    return this.page.getByRole("dialog");
  }
}

/** Administration → Action history (FR-PLT-008). */
export class AuditPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  /** The history of one record. */
  async gotoRecord(entityId: string): Promise<void> {
    await this.page.goto(`/admin/audit?record=${entityId}`);
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: labels.audit.title });
  }

  rows(): Locator {
    return this.table.locator("tbody > tr");
  }
}
