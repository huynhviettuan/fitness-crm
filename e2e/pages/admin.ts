import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

const r = labels.roles;
const u = labels.users;

/** Administration → Branches (FR-PLT-004). */
export class BranchesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/branches");
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: labels.branches.title });
  }

  async create(name: string, address: string): Promise<void> {
    await this.shell.main.getByRole("button", { name: labels.branches.create }).click();
    const dialog = this.page.getByRole("dialog", { name: labels.branches.create });
    await dialog.getByLabel(labels.branches.fields.name).fill(name);
    await dialog.getByLabel(labels.branches.fields.address).fill(address);
    await dialog.getByRole("button", { name: labels.common.save }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

/** Administration → Roles and permissions (FR-PLT-002): the list and the role editor. */
export class RolesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async gotoNew(): Promise<void> {
    await this.page.goto("/admin/roles/new");
  }

  get main(): Locator {
    return this.shell.main;
  }

  async fillName(name: string): Promise<void> {
    await this.main.getByLabel(r.fields.name, { exact: true }).fill(name);
  }

  /** Ticks or clears one permission in the tree. */
  async setPermission(label: string, on: boolean): Promise<void> {
    await this.main.getByRole("checkbox", { name: label, exact: true }).setChecked(on);
  }

  async setDataScope(resource: string, scope: string): Promise<void> {
    await this.main.getByRole("combobox", { name: resource, exact: true }).click();
    await this.page.getByRole("option", { name: scope, exact: true }).click();
  }

  async setHidden(field: string, on: boolean): Promise<void> {
    await this.main.getByRole("checkbox", { name: field, exact: true }).setChecked(on);
  }

  async save(): Promise<void> {
    await this.main.getByRole("button", { name: labels.common.save, exact: true }).click();
  }

  heading(name: string): Locator {
    return this.shell.pageHeading(name);
  }
}

/** Administration → Users → one user (FR-PLT-001, FR-PLT-003). */
export class UserDetailPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(userId: string): Promise<void> {
    await this.page.goto(`/admin/users/${userId}`);
  }

  async openTab(name: string): Promise<Locator> {
    await this.shell.main.getByRole("tab", { name }).click();
    return this.shell.main.getByRole("tabpanel", { name });
  }

  /** Permissions tab: sets one permission to "inherit", "on", or "off" and saves. */
  async setOverride(permissionLabel: string, choice: string): Promise<void> {
    const panel = await this.openTab(u.tabs.permissions);
    await panel.getByRole("combobox", { name: permissionLabel, exact: true }).click();
    await this.page.getByRole("option", { name: choice, exact: true }).click();
    await panel.getByRole("button", { name: labels.common.save }).click();
  }

  /** Sign-in hours tab: one window on a single day, all day, then saves. */
  async allowOnlyDay(day: string): Promise<void> {
    const panel = await this.openTab(u.tabs.accessHours);
    await panel.getByRole("button", { name: u.accessHours.add }).click();
    const days = panel.getByRole("group", { name: u.accessHours.weekdays });
    for (const label of Object.values(u.accessHours.days)) {
      await days.getByRole("checkbox", { name: label, exact: true }).setChecked(label === day);
    }
    await panel.getByLabel(u.accessHours.from).fill("00:00");
    await panel.getByLabel(u.accessHours.to).fill("23:59");
    await panel.getByRole("button", { name: labels.common.save }).click();
  }

  async loginHistory(): Promise<Locator> {
    return (await this.openTab(u.tabs.logins)).getByRole("table");
  }
}
