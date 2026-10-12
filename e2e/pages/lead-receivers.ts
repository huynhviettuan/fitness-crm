import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const r = labels.leadReceivers;

/** Who receives leads and their turn weight (D-050). Every locator is scoped to the page's table. */
export class LeadReceiversPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/leads/receivers");
    await this.shell.pageHeading(r.title).waitFor();
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: r.title });
  }

  row(name: string): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  receivingSwitch(name: string): Locator {
    return this.row(name).getByRole("switch", { name: fill(r.receivesFor, { name }) });
  }

  weightInput(name: string): Locator {
    return this.row(name).getByLabel(fill(r.weightFor, { name }));
  }

  saveButton(name: string): Locator {
    return this.row(name).getByRole("button", { name: fill(r.saveFor, { name }) });
  }
}
