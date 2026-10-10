import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const a = labels.approvals;

/** The approvals inbox (FR-PLT-007). */
export class ApprovalsPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(view: "toDecide" | "mine" | "all"): Promise<void> {
    await this.page.goto(`/approvals?view=${view}`);
  }

  table(view: "toDecide" | "mine" | "all"): Locator {
    return this.shell.main.getByRole("table", { name: a.views[view] });
  }

  row(title: string): Locator {
    return this.shell.main.getByRole("row").filter({ hasText: title });
  }

  approveButton(title: string): Locator {
    return this.shell.main.getByRole("button", { name: fill(a.approveLabel, { name: title }), exact: true });
  }

  async approve(title: string): Promise<void> {
    await this.approveButton(title).click();
    const dialog = this.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: a.approve, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  /** Rejects with "Khác" (the seeded option) and a note. */
  async reject(title: string, note: string, otherLabel: string): Promise<void> {
    await this.shell.main.getByRole("button", { name: fill(a.rejectLabel, { name: title }), exact: true }).click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: a.rejectReason, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: otherLabel, exact: true }).click();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill(note);
    await dialog.getByRole("button", { name: a.reject, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

/** Administration → Approval matrix (D-018). */
export class ApprovalRulesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/approvals");
  }

  row(actionLabel: string): Locator {
    return this.shell.main.getByRole("table", { name: labels.approvalRules.title }).getByRole("row").filter({ hasText: actionLabel });
  }

  /** Ticks or clears one approver role of an action, then saves. */
  async setApprover(actionLabel: string, roleName: string, on: boolean): Promise<void> {
    await this.shell.main.getByRole("button", { name: fill(labels.approvalRules.editLabel, { name: actionLabel }), exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: actionLabel });
    await dialog.getByRole("checkbox", { name: roleName, exact: true }).setChecked(on);
    await dialog.getByRole("button", { name: labels.common.save, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}
