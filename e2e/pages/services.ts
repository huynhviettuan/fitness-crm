import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const s = labels.services;

/** The services admin page (FR-SVC-001, D-021). */
export class ServicesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/services");
    await this.shell.pageHeading(s.title).waitFor();
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: s.title });
  }

  row(name: string): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get createButton(): Locator {
    return this.shell.main.getByRole("button", { name: s.create });
  }

  async openCreate(): Promise<ServiceDialog> {
    await this.createButton.click();
    return new ServiceDialog(this.page.getByRole("dialog", { name: s.create }));
  }
}

/** The "Add service" / "Edit service" dialog. */
export class ServiceDialog {
  constructor(readonly root: Locator) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}

/** One service: its price list in versions, the quick-pick counts, and the price lookup. */
export class ServiceDetailPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  heading(name: string): Locator {
    return this.shell.pageHeading(name);
  }

  async openTab(name: string): Promise<void> {
    await this.shell.main.getByRole("tab", { name, exact: true }).click();
  }

  get newVersionButton(): Locator {
    return this.shell.main.getByRole("button", { name: s.tiers.newVersion });
  }

  /** The card of one version of the price list, e.g. "v1". */
  version(number: number): Locator {
    return this.shell.main.getByRole("region", { name: `v${number}` });
  }

  async openNewVersion(): Promise<TiersDialog> {
    await this.newVersionButton.click();
    return new TiersDialog(this.page.getByRole("dialog", { name: s.tiers.newVersionTitle }));
  }

  /** The "Try a price" card. */
  get lookup(): Locator {
    return this.shell.main
      .getByRole("heading", { name: s.lookup.title })
      .locator("xpath=ancestor::div[@data-slot='card']");
  }

  async tryPrice(sessions: number, startDate?: string): Promise<void> {
    await this.lookup.getByLabel(s.lookup.sessions, { exact: true }).fill(String(sessions));
    if (startDate) await this.lookup.getByLabel(s.lookup.startDate, { exact: true }).fill(startDate);
    await this.lookup.getByRole("button", { name: s.lookup.run }).click();
  }

  async openPackages(): Promise<Locator> {
    await this.shell.main.getByRole("button", { name: s.packages.edit }).click();
    return this.page.getByRole("dialog", { name: s.packages.edit });
  }

  packageBadge(count: number): Locator {
    return this.shell.main.getByText(fill(s.packages.unit, { count }), { exact: true });
  }
}

/** The "New version" dialog: the whole set of tiers again, from a day on. */
export class TiersDialog {
  constructor(readonly root: Locator) {}

  get effectiveFrom(): Locator {
    return this.root.getByLabel(s.tiers.effectiveFrom, { exact: true });
  }

  /** A cell of tier `row` (1-based): "minSessions", "maxSessions", "unitPrice", "validityMonths", or "validityDays". */
  cell(column: "minSessions" | "maxSessions" | "unitPrice" | "validityMonths" | "validityDays", row: number): Locator {
    return this.root.getByLabel(`${s.tiers.columns[column]} ${row}`, { exact: true });
  }

  async fillTier(
    row: number,
    tier: { min: number; max: number | null; price: number; months: number; days?: number },
  ): Promise<void> {
    await this.cell("minSessions", row).fill(String(tier.min));
    await this.cell("maxSessions", row).fill(tier.max === null ? "" : String(tier.max));
    await this.cell("unitPrice", row).fill(String(tier.price));
    await this.cell("validityMonths", row).fill(String(tier.months));
    await this.cell("validityDays", row).fill(String(tier.days ?? 0));
  }

  async addRow(): Promise<void> {
    await this.root.getByRole("button", { name: s.tiers.addRow }).click();
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: s.tiers.saveVersion }).click();
  }

  get fieldErrors(): Locator {
    return this.root.locator('[data-slot="field-error"]');
  }
}
