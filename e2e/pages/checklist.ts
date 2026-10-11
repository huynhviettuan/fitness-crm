import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const c = labels.checklist;

/** Recording a consulting step's result (FR-LEAD-004). Scoped to the dialog. */
export class CompleteStepDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  async choose(result: string): Promise<void> {
    await this.root.getByRole("combobox", { name: c.result, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name: result, exact: true }).click();
  }

  async note(text: string): Promise<void> {
    await this.root.getByLabel(c.note, { exact: true }).fill(text);
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: c.save, exact: true }).click();
  }
}

/** Opens the completion dialog from a "Hoàn thành" button inside `scope`. */
export async function openCompleteStep(page: Page, scope: Locator, step: string): Promise<CompleteStepDialog> {
  await scope.getByRole("button", { name: fill(c.completeLabel, { step }), exact: true }).click();
  return new CompleteStepDialog(page, page.getByRole("dialog", { name: step }));
}

/** "Việc hôm nay" (FR-LEAD-005): due consulting steps, one card each. */
export class TodayPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(scope: "mine" | "all" = "mine"): Promise<void> {
    await this.page.goto(scope === "all" ? "/leads/today?scope=all" : "/leads/today");
  }

  get list(): Locator {
    return this.shell.main.getByRole("list", { name: labels.today.title });
  }

  /** The card of one step of one lead. */
  item(leadName: string, step: string): Locator {
    return this.list.getByRole("listitem").filter({ hasText: leadName }).filter({ hasText: step });
  }

  async complete(leadName: string, step: string): Promise<CompleteStepDialog> {
    return openCompleteStep(this.page, this.item(leadName, step), step);
  }
}

/** Administration → Consulting checklist (D-020): the steps as a form; saving makes a new version. */
export class ChecklistAdminPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/admin/checklist");
  }

  /** One step's fieldset, by its position. */
  step(number: number): Locator {
    return this.shell.main.getByRole("group", {
      name: fill(labels.checklistAdmin.stepLegend, { number }),
      exact: true,
    });
  }

  field(number: number, label: string): Locator {
    return this.step(number).getByLabel(label, { exact: true });
  }

  /** A drop-down of one step, by its label. */
  choice(number: number, label: string): Locator {
    return this.step(number).getByRole("combobox", { name: label, exact: true });
  }

  async save(): Promise<void> {
    await this.shell.main.getByRole("button", { name: labels.checklistAdmin.save, exact: true }).click();
  }
}
