import { expect, signedInAs, test } from "./fixtures";
import { approvePendingViaApi } from "./support/approvals";
import { bookingSetup } from "./support/data";
import { labels } from "./support/labels";

// Workout plans and templates (brief §7.1, §7.2; FR-WKO-001, FR-WKO-002; D-033, D-018; docs/13 E2E-170): a coach writes a plan
// from the catalog, sends it to the Master, and after approval it is read-only; a change is a revision.
const w = labels.workoutPlans;
const tab = labels.customers.tabs.plans;

/** The catalog a plan is made from, named with the test's tag (so the search finds only these). */
async function catalog(apiAs: Parameters<typeof bookingSetup>[0], tag: string) {
  const admin = await apiAs("ADMIN");
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await admin.post(`/api/v1/workout/${path}`, { data });
    expect(response.status(), path).toBe(201);
    return (await response.json()) as { id: string };
  };
  await post("stages", { name: `Rehab ${tag}` });
  const area = await post("areas", { code: `A-${tag}`, name: `Vùng ${tag}` });
  await post("exercises", { name: `Squat ${tag}`, areaId: area.id, kind: "STRENGTH" });
  await post("exercises", { name: `Chạy bộ ${tag}`, areaId: area.id, kind: "CARDIO" });
  return { stage: `Rehab ${tag}`, squat: `Squat ${tag}`, run: `Chạy bộ ${tag}` };
}

test.describe("a coach's plan", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("@smoke E2E-170: a plan is written from the catalog, sent to the Master, read-only once approved, and changed by a revision", async ({
    page,
    apiAs,
    testTag,
    customerDetailPage,
    workoutPlanPage: plan,
  }) => {
    const { customer, trainer } = await bookingSetup(apiAs, testTag);
    const items = await catalog(apiAs, testTag);
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);

    // Add a blank plan from the customer's page.
    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(tab);
    await customerDetailPage.tabPanel(tab).getByRole("button", { name: w.newPlan, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: w.newPlan });
    await dialog.getByRole("combobox", { name: w.fields.trainer, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: trainer.fullName, exact: true }).click();
    await dialog.getByLabel(w.fields.nameOptional, { exact: true }).fill(`Giáo án ${testTag}`);
    await dialog.getByRole("button", { name: w.create, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Giáo án ${testTag}` })).toBeVisible();
    await expect(notice(w.created)).toBeVisible();

    // Nothing to send yet.
    await plan.saveAndSend();
    await expect(plan.problems).toContainText(w.problems);

    // A stage with a session and the two kinds of exercise.
    await page.getByRole("button", { name: w.addStage, exact: true }).click();
    const stage = plan.stage(1);
    await plan.chooseStage(stage, items.stage);
    await stage.getByRole("button", { name: w.addSession, exact: true }).click();
    const session = plan.session(stage, 1);
    await session.getByLabel(w.fields.sessionGoal, { exact: true }).fill("Làm quen bài tập");
    await plan.addExercise(session, testTag, items.squat);
    await plan.addExercise(session, testTag, items.run);

    // Strength sets have weight and reps; Cardio sets have time, speed and heart rate instead.
    const strength = session.getByRole("group", { name: items.squat, exact: true });
    await expect(strength.getByRole("columnheader", { name: w.set.weight })).toBeVisible();
    await expect(strength.getByRole("columnheader", { name: w.set.durationMinutes })).toHaveCount(0);
    const cardio = session.getByRole("group", { name: items.run, exact: true });
    await expect(cardio.getByRole("columnheader", { name: w.set.durationMinutes })).toBeVisible();
    await expect(cardio.getByRole("columnheader", { name: w.set.weight })).toHaveCount(0);
    await plan.target(session, items.squat, 1, w.set.weight).fill("40");
    await plan.target(session, items.squat, 1, w.set.reps).fill("10");
    await plan.target(session, items.run, 1, w.set.durationMinutes).fill("15");
    await plan.target(session, items.run, 1, w.set.speed).fill("8,5");

    // A weight that is not a number is shown before anything is sent.
    await plan.target(session, items.squat, 1, w.set.weight).fill("nặng");
    await plan.saveDraft();
    await expect(plan.problems).toContainText(labels.validation.invalidNumber);
    await plan.target(session, items.squat, 1, w.set.weight).fill("40");

    await plan.saveAndSend();
    await expect(notice(w.sent)).toBeVisible();
    // Waiting for the Master: read-only, and nothing to edit.
    await expect(page.getByText(w.waiting)).toBeVisible();
    await expect(plan.main.getByRole("button", { name: w.saveDraft, exact: true })).toHaveCount(0);
    const planId = plan.id;

    // The Master (an admin here, D-049) approves; the submitter cannot.
    await approvePendingViaApi(await apiAs("ADMIN"), planId, "workout.plan");
    await plan.goto(planId);
    const table = plan.main.getByRole("table", { name: items.squat });
    await expect(table).toContainText("40");
    await expect(table).toContainText("10");
    await expect(plan.main.getByRole("table", { name: items.run })).toContainText("8.5");
    await expect(plan.main.getByRole("button", { name: w.saveDraft, exact: true })).toHaveCount(0);
    await expect(page.getByText(labels.status.plan.APPROVED).first()).toBeVisible();

    // To change it: a revision, a draft that replaces it when approved.
    await plan.main.getByRole("button", { name: w.revise, exact: true }).click();
    await expect(page.getByText(w.replaces)).toBeVisible();
    await expect(plan.main.getByRole("button", { name: w.saveDraft, exact: true })).toBeVisible();
    await expect(plan.target(plan.session(plan.stage(1), 1), items.squat, 1, w.set.weight)).toHaveValue("40");
  });

  test("a template is written, approved, and then makes a plan with its weeks and sessions", async ({
    page,
    apiAs,
    testTag,
    workoutPlanPage: plan,
  }) => {
    const { customer, contract, trainer } = await bookingSetup(apiAs, testTag);
    const items = await catalog(apiAs, testTag);

    await page.goto("/workouts/templates");
    await page.getByRole("button", { name: w.newTemplate, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: w.newTemplate });
    await dialog.getByLabel(w.fields.name, { exact: true }).fill(`Template ${testTag}`);
    await dialog.getByRole("button", { name: w.create, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Template ${testTag}` })).toBeVisible();

    await page.getByRole("button", { name: w.addStage, exact: true }).click();
    const stage = plan.stage(1);
    await plan.chooseStage(stage, items.stage);
    // A template has one session per stage and no weeks.
    await expect(stage.getByRole("button", { name: w.addSession, exact: true })).toHaveCount(0);
    const session = plan.session(stage, 1);
    await expect(session.getByLabel(w.fields.week, { exact: true })).toHaveCount(0);
    await plan.addExercise(session, testTag, items.squat);
    await plan.target(session, items.squat, 1, w.set.reps).fill("8");
    await plan.saveAndSend();
    await expect(page.getByText(w.waiting)).toBeVisible();
    const templateId = plan.id;
    await approvePendingViaApi(await apiAs("ADMIN"), templateId, "workout.plan");

    // A plan from it: two weeks of three sessions.
    const made = await (
      await apiAs("FITNESS_MANAGER")
    ).post("/api/v1/workout/plans", {
      data: {
        kind: "CUSTOMER",
        customerId: customer.id,
        contractId: contract.id,
        trainerId: trainer.id,
        templateId,
        weeksPerStage: 2,
        sessionsPerWeek: 3,
      },
    });
    expect(made.status()).toBe(201);
    const created = (await made.json()) as { id: string; stages: { sessions: unknown[] }[] };
    expect(created.stages.flatMap((stage) => stage.sessions)).toHaveLength(6);
    await plan.goto(created.id);
    // It is a draft, so each session is an editor block; the sixth is week 2.
    const last = plan.session(plan.stage(1), 6);
    await expect(last.getByLabel(w.fields.week, { exact: true })).toHaveValue("2");
  });
});

test.describe("who may read plans", () => {
  test.describe("reception", () => {
    test.use(signedInAs("RECEPTIONIST"));

    test("has no plans, templates or tab", async ({ page, apiAs }) => {
      for (const path of ["/workouts/plans", "/workouts/templates"]) {
        await page.goto(path);
        await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
      }
      expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/workout/plans")).status()).toBe(403);
    });
  });
});
