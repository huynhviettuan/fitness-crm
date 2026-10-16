import type { Locator, Page } from "@playwright/test";
import { fill, labels } from "../support/labels";
import { AppShell } from "./app-shell";

const w = labels.workoutPlans;

/** A workout plan or template (M7.2): its editor while it is a draft, and its read-only page after. */
export class WorkoutPlanPage {
  private readonly shell: AppShell;

  constructor(private readonly page: Page) {
    this.shell = new AppShell(page);
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/workouts/plans/${id}`);
  }

  get main(): Locator {
    return this.shell.main;
  }

  /** The id of the plan the page shows, from its address. */
  get id(): string {
    return this.page.url().split("/").pop()!.split("?")[0]!;
  }

  stage(n: number): Locator {
    return this.main.getByRole("region", { name: fill(w.place.stages, { n }), exact: true });
  }

  session(stage: Locator, n: number): Locator {
    return stage.getByRole("group", { name: fill(w.place.sessions, { n }), exact: true });
  }

  /** Picks the catalog stage of a stage block. */
  async chooseStage(stage: Locator, name: string): Promise<void> {
    await stage.getByRole("combobox", { name: w.fields.stage, exact: true }).click();
    await this.page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
  }

  /** Adds a session to a stage block and opens the exercise picker for it, choosing the exercise found by `search`. */
  async addExercise(session: Locator, search: string, exercise: string): Promise<void> {
    await session.getByRole("button", { name: w.addExercise, exact: true }).click();
    const picker = this.page.getByRole("dialog", { name: w.pickExercise });
    await picker.getByLabel(w.searchExercise, { exact: true }).fill(search);
    await picker.getByRole("button", { name: new RegExp(exercise) }).click();
  }

  /** A target field of a set of an exercise block (the block is named after the exercise). */
  target(session: Locator, exercise: string, set: number, field: string): Locator {
    return session
      .getByRole("group", { name: exercise, exact: true })
      .getByLabel(`${fill(w.place.sets, { n: set })} · ${field}`, { exact: true });
  }

  async saveDraft(): Promise<void> {
    await this.main.getByRole("button", { name: w.saveDraft, exact: true }).click();
  }

  async saveAndSend(): Promise<void> {
    await this.main.getByRole("button", { name: w.saveAndSend, exact: true }).click();
  }

  get problems(): Locator {
    return this.main.getByRole("alert");
  }
}
