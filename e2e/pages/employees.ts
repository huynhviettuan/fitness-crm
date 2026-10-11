import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const e = labels.employees;
const s = labels.employees.schedule;

/** The day name the schedule uses, e.g. "Thứ 5" for ISO weekday 4. */
export function weekdayLabel(weekday: number): string {
  return s.weekdays[String(weekday) as keyof typeof s.weekdays];
}

/** The "Add employee" / "Edit details" dialog. Every locator is scoped to it. */
export class EmployeeFormDialog {
  constructor(readonly root: Locator) {}

  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  async fill(input: { fullName: string; phone?: string; isTrainer?: boolean }): Promise<void> {
    await this.field(e.fields.fullName).fill(input.fullName);
    if (input.phone !== undefined) await this.field(e.fields.phone).fill(input.phone);
    if (input.isTrainer) await this.root.getByRole("switch", { name: e.fields.isTrainer }).check();
  }

  async save(): Promise<void> {
    await this.root.getByRole("button", { name: labels.common.save }).click();
  }
}

/** The employee list (brief §8.4). */
export class EmployeesPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/employees${query}`);
  }

  get table(): Locator {
    return this.shell.main.getByRole("table", { name: e.title });
  }

  row(text: string): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  get addButton(): Locator {
    return this.shell.main.getByRole("button", { name: e.create, exact: true });
  }

  async openAdd(): Promise<EmployeeFormDialog> {
    await this.addButton.click();
    return new EmployeeFormDialog(this.page.getByRole("dialog", { name: e.create }));
  }

  async open(fullName: string): Promise<void> {
    await this.table.getByRole("link", { name: fill(e.open, { name: fullName }), exact: true }).click();
  }
}

/** One employee: profile, weekly shifts, and days off (D-030). */
export class EmployeePage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/employees/${id}`);
  }

  /** One weekday's line of the shift editor. */
  day(weekday: number): Locator {
    return this.shell.main.getByRole("group", { name: weekdayLabel(weekday), exact: true });
  }

  /** Adds a shift to a weekday and types its times. */
  async addShift(weekday: number, start: string, end: string): Promise<void> {
    const day = weekdayLabel(weekday);
    await this.day(weekday)
      .getByRole("button", { name: fill(s.addShift, { day }), exact: true })
      .click();
    const number = await this.day(weekday)
      .getByRole("button", { name: new RegExp(`^${fill(s.removeShift, { number: "\\d+", day })}$`) })
      .count();
    await this.day(weekday).getByLabel(fill(s.shiftStart, { day, number }), { exact: true }).fill(start);
    await this.day(weekday).getByLabel(fill(s.shiftEnd, { day, number }), { exact: true }).fill(end);
  }

  get saveScheduleButton(): Locator {
    return this.shell.main.getByRole("button", { name: s.save, exact: true });
  }

  async saveSchedule(): Promise<void> {
    await this.saveScheduleButton.click();
  }

  get daysOff(): Locator {
    return this.shell.main.getByRole("table", { name: s.daysOff });
  }

  async addDayOff(date: string, note = ""): Promise<void> {
    await this.shell.main.getByLabel(s.date, { exact: true }).fill(date);
    await this.shell.main.getByLabel(s.note, { exact: true }).fill(note);
    await this.shell.main.getByRole("button", { name: s.addDayOff, exact: true }).click();
  }

  async editDetails(): Promise<EmployeeFormDialog> {
    await this.shell.main.getByRole("button", { name: e.edit, exact: true }).click();
    return new EmployeeFormDialog(this.page.getByRole("dialog", { name: e.edit }));
  }
}
