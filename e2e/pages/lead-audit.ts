import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";
import { AppShell } from "./app-shell";

const a = labels.leadAudit;

/** The automatic consulting audit page (FR-LEAD-011): the consultants' table and "Leads to check". */
export class LeadAuditPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/leads/audit${query}`);
    await this.shell.pageHeading(a.title).waitFor();
  }

  get consultants(): Locator {
    return this.shell.main.getByRole("table", { name: a.consultants });
  }

  get toCheck(): Locator {
    return this.shell.main.getByRole("table", { name: a.toCheck });
  }

  consultantRow(name: string): Locator {
    return this.consultants.getByRole("row").filter({ hasText: name });
  }

  toCheckRow(text: string): Locator {
    return this.toCheck.getByRole("row").filter({ hasText: text });
  }
}

/** The audit card on a lead's page. */
export function auditCard(page: Page): Locator {
  return page.getByRole("region", { name: a.tab.title, exact: true });
}

/** The manager's audit card on a lead's page (A-086). */
export function managerAuditCard(page: Page): Locator {
  return page.getByRole("region", { name: a.manager.title, exact: true });
}
