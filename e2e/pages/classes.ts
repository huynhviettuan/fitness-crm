import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { OTHER_OPTION_LABEL } from "../support/options";
import { AppShell } from "./app-shell";

const c = labels.classes;

/** The class schedule (M5.5): the week board, a class session's sheet, and the class definitions. */
export class ClassesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(view?: "manage"): Promise<void> {
    await this.page.goto(view ? `/classes?view=${view}` : "/classes");
  }

  /** The cards of the week board that mention `text`. */
  card(text: string): Locator {
    return this.shell.main.getByTestId("class-card").filter({ hasText: text });
  }

  /** Opens a class session's sheet from its card. */
  async open(text: string): Promise<ClassSheetPanel> {
    await this.card(text).first().click();
    return new ClassSheetPanel(this.page, this.page.getByRole("dialog"));
  }

  /** A row of the class definitions that mentions `text`. */
  row(text: string): Locator {
    return this.shell.main.getByRole("row").filter({ hasText: text });
  }

  /** Adds a class (days given as ISO numbers) and leaves the dialog closed. */
  async addClass(input: {
    name: string;
    branch: string;
    coach: string;
    capacity: number;
    weekdays: number[];
    startTime: string;
    endTime: string;
  }): Promise<void> {
    await this.shell.main.getByRole("button", { name: c.add, exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: c.add });
    await dialog.getByLabel(c.fields.name, { exact: true }).fill(input.name);
    await this.choose(dialog, c.fields.branch, input.branch);
    await this.choose(dialog, c.fields.coach, input.coach);
    await dialog.getByLabel(c.fields.capacity, { exact: true }).fill(String(input.capacity));
    for (const day of input.weekdays) {
      await dialog
        .getByRole("checkbox", { name: c.weekdays[String(day) as keyof typeof c.weekdays], exact: true })
        .check();
    }
    await dialog.getByLabel(c.fields.startTime, { exact: true }).fill(input.startTime);
    await dialog.getByLabel(c.fields.endTime, { exact: true }).fill(input.endTime);
    await dialog.getByRole("button", { name: labels.common.save }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  private async choose(dialog: Locator, label: string, optionText: string): Promise<void> {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option").filter({ hasText: optionText }).first().click();
  }
}

/** A class session's sheet: its seats, enrolling, and attendance. */
export class ClassSheetPanel {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  /** The seat of the customer named `name`. */
  seat(name: string): Locator {
    return this.root.getByRole("listitem").filter({ hasText: name });
  }

  get seats(): Locator {
    return this.root.getByTestId("class-seats");
  }

  /** Enrolls a customer found by `query` (the picked result shows `code`) on their first class contract. */
  async enroll(query: string, code: string): Promise<void> {
    const form = this.root.getByRole("form", { name: c.enrollTitle });
    await form.getByLabel(labels.bookings.fields.customer, { exact: true }).fill(query);
    await form.getByRole("option").filter({ hasText: code }).click();
    await form.getByRole("combobox", { name: c.contract, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option").first().click();
    await form.getByRole("button", { name: c.enroll, exact: true }).click();
  }

  action(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }
}

export { fill, OTHER_OPTION_LABEL };
