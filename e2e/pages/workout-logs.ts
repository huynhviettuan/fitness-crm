import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const w = labels.workoutLogs;
const plans = labels.workoutPlans;

/** The session log of a PT session (M7.3): three parts, and a row per set with the plan and the actual together. */
export class WorkoutLogPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/workouts/logs/${id}`);
  }

  get main(): Locator {
    return this.shell.main;
  }

  /** The id of the log the page shows, from its address. */
  get id(): string {
    return this.page.url().split("/").pop()!.split("?")[0]!;
  }

  part(name: string): Locator {
    return this.main.getByRole("region", { name, exact: true });
  }

  exercise(name: string): Locator {
    return this.main.getByRole("group", { name, exact: true });
  }

  /** The row of a set: the plan's line and the actual fields. */
  set(exercise: string, n: number): Locator {
    return this.main.getByRole("group", { name: `${exercise} · ${fill(plans.place.sets, { n })}`, exact: true });
  }

  /** An actual field of a set (weight, reps, RIR, time, speed, heart rate). */
  actual(exercise: string, n: number, field: string): Locator {
    return this.set(exercise, n).getByLabel(`${fill(plans.place.sets, { n })} · ${field}`, { exact: true });
  }

  /** A Flag or Action select of a set. */
  choice(exercise: string, n: number, field: string): Locator {
    return this.set(exercise, n).getByRole("combobox", {
      name: `${fill(plans.place.sets, { n })} · ${field}`,
      exact: true,
    });
  }

  async pick(select: Locator, option: string): Promise<void> {
    await select.click();
    await this.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  }

  /** A scale or option select of the before and after parts, by its label. */
  field(label: string): Locator {
    return this.main.getByRole("combobox", { name: label, exact: true });
  }

  async addExercise(search: string, exercise: string): Promise<void> {
    await this.main.getByRole("button", { name: plans.addExercise, exact: true }).click();
    const picker = this.page.getByRole("dialog", { name: plans.pickExercise });
    await picker.getByLabel(plans.searchExercise, { exact: true }).fill(search);
    await picker.getByRole("button", { name: new RegExp(exercise) }).click();
  }

  async save(): Promise<void> {
    await this.main.getByRole("button", { name: w.save, exact: true }).click();
  }

  get problems(): Locator {
    return this.main.getByRole("alert");
  }
}
