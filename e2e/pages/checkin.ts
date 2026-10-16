import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

const c = labels.checkin;

/** The check-in screen: hanging sessions, scan errors, the report, and the machines (M5.3b). */
export class CheckinPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(view?: "errors" | "scans" | "manual" | "devices"): Promise<void> {
    await this.page.goto(view ? `/checkin?view=${view}` : "/checkin");
  }

  /** A row of the open table that mentions `text`. */
  row(text: string): Locator {
    return this.shell.main.getByRole("row").filter({ hasText: text });
  }

  action(rowText: string, name: string): Locator {
    return this.row(rowText).getByRole("button", { name, exact: true });
  }

  /** Registers a machine and returns the key shown once. */
  async addDevice(name: string, branch?: string): Promise<string> {
    await this.shell.main.getByRole("button", { name: c.addDevice, exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: c.addDevice });
    await dialog.getByLabel(c.fields.device, { exact: true }).fill(name);
    if (branch) {
      await dialog.getByRole("combobox", { name: c.fields.branch, exact: true }).click();
      await this.page.getByRole("listbox").getByRole("option", { name: branch, exact: true }).click();
    }
    await dialog.getByRole("button", { name: c.register, exact: true }).click();
    return this.readKey();
  }

  /** Reads the key the dialog shows once, and closes it. */
  async readKey(): Promise<string> {
    const dialog = this.page.getByRole("dialog", { name: c.keyTitle });
    const key = await dialog.getByTestId("device-key").innerText();
    await dialog.getByRole("button", { name: c.keyDone }).click();
    await dialog.waitFor({ state: "hidden" });
    return key;
  }

  /** The machine-code card on a customer's or an employee's page. */
  async setMachineCode(code: string): Promise<void> {
    await this.shell.main.getByLabel(c.machineCode, { exact: true }).fill(code);
    await this.shell.main.getByRole("button", { name: c.save, exact: true }).click();
  }
}
