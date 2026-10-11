import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const k = labels.tasks;

/** The "New task" / "Edit task" dialog. Every locator is scoped to it. */
export class TaskFormDialog {
  constructor(
    private readonly page: Page,
    readonly root: Locator,
  ) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: { title: string; assignee: string; dueDate: string; dueTime?: string; priority?: string }): Promise<void> {
    await this.field(k.fields.title).fill(input.title);
    await this.choose(k.fields.assignee, input.assignee);
    await this.field(k.fields.dueDate).fill(input.dueDate);
    if (input.dueTime) await this.field(k.fields.dueTime).fill(input.dueTime);
    if (input.priority) await this.choose(k.fields.priority, input.priority);
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }

  private async choose(label: string, optionText: string): Promise<void> {
    await this.root.getByRole("combobox", { name: label, exact: true }).click();
    // The open listbox is rendered outside the dialog and owns the options.
    await this.page.getByRole("listbox").getByRole("option").filter({ hasText: optionText }).first().click();
  }
}

/** Công việc: the views, filters, and the task list (brief §8.2). */
export class TasksPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/tasks${query}`);
  }

  table(viewName: string): Locator {
    return this.shell.main.getByRole("table", { name: viewName });
  }

  row(viewName: string, text: string): Locator {
    return this.table(viewName).getByRole("row").filter({ hasText: text });
  }

  async openCreate(): Promise<TaskFormDialog> {
    await this.shell.main.getByRole("button", { name: k.create, exact: true }).click();
    return new TaskFormDialog(this.page, this.page.getByRole("dialog", { name: k.create }));
  }

  async open(viewName: string, title: string): Promise<void> {
    await this.table(viewName).getByRole("link", { name: fill(k.open, { title }), exact: true }).click();
  }
}

/** One task: its details, the moves, and the discussion. */
export class TaskPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/tasks/${id}`);
  }

  heading(title: string): Locator {
    return this.shell.pageHeading(title);
  }

  /** The task's details; scoped, since a page navigated away from can stay in the DOM, hidden. */
  get details(): Locator {
    return this.shell.main.getByRole("region", { name: k.details });
  }

  /** The value (<dd>) next to a label (<dt>). */
  detail(label: string): Locator {
    return this.details.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
  }

  move(name: string): Locator {
    return this.shell.main.getByRole("button", { name, exact: true });
  }

  get comments(): Locator {
    return this.shell.main.getByRole("list", { name: k.comments });
  }

  async comment(body: string, mention?: string): Promise<void> {
    await this.shell.main.getByLabel(k.comment, { exact: true }).fill(body);
    if (mention) {
      await this.shell.main.getByRole("button", { name: k.mention, exact: true }).click();
      await this.page.getByRole("menuitemcheckbox", { name: mention, exact: true }).click();
      await this.page.keyboard.press("Escape");
    }
    await this.shell.main.getByRole("button", { name: k.send, exact: true }).click();
  }
}

/** The notification bell in the top bar and the full list page (FR-PLT-009). */
export class NotificationsPage {
  constructor(private readonly page: Page) {}

  get bell(): Locator {
    return this.page.getByRole("banner").getByRole("button", { name: new RegExp(`^${labels.notifications.title} \\(`) });
  }

  async openBell(): Promise<Locator> {
    await this.bell.click();
    return this.page.getByRole("menu");
  }

  async goto(): Promise<void> {
    await this.page.goto("/notifications");
  }

  get list(): Locator {
    return this.page.getByRole("main").getByRole("list", { name: labels.notifications.title });
  }
}
