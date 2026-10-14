import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "./support/data";
import { E2E_TRAINER_NAME } from "./support/db";
import { fill, labels } from "./support/labels";
import { OTHER_OPTION_LABEL } from "./support/options";
import { approvedPlanViaApi, workoutCatalog, type ApiAs } from "./support/workouts";

// The session log (brief §7.3; FR-WKO-003; D-033; AC-20, AC-23; docs/13 E2E-171): opened from a PT session, plan and actual on
// one row per set, the actual starting as the plan, filled in by the coach on a phone.
const w = labels.workoutLogs;
const p = labels.workoutPlans;

/** A customer with an approved plan for the E2E coach, and two PT sessions on one day (10:00 and 12:00). */
async function sessionsWithPlan(
  apiAs: ApiAs,
  tag: string,
  sessions = 2,
): Promise<{
  customer: Awaited<ReturnType<typeof bookingSetup>>["customer"];
  catalog: Awaited<ReturnType<typeof workoutCatalog>>;
  day: ReturnType<typeof randomBookingDay>;
  bookings: [string, string];
}> {
  const { customer, refs } = await bookingSetup(apiAs, tag);
  // The coach is the employee the PT login belongs to, so the PT owns these sessions.
  const { employeeId: trainerId } = (await (await (await apiAs("PT")).get("/api/v1/me")).json()) as {
    employeeId: string;
  };
  const catalog = await workoutCatalog(apiAs, tag);
  await approvedPlanViaApi(apiAs, { customerId: customer.id, contractId: refs.contractId, trainerId }, catalog, tag);
  const reception = await apiAs("RECEPTIONIST");
  const day = randomBookingDay();
  const first = await createBookingViaApi(
    reception,
    { ...refs, trainerId },
    { date: day.date, startTime: "10:00", endTime: "11:00" },
  );
  const second =
    sessions > 1
      ? await createBookingViaApi(
          reception,
          { ...refs, trainerId },
          { date: day.date, startTime: "12:00", endTime: "13:00" },
        )
      : first;
  return { customer, catalog, day, bookings: [first.id, second.id] };
}

test.describe("a coach's log on a phone", () => {
  test.use({ ...signedInAs("PT"), viewport: { width: 375, height: 812 } });

  test("@smoke E2E-171: the log opens from the session with the plan and the actual on one row, and the coach keeps the differences", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
    workoutLogPage: log,
  }) => {
    const { customer, catalog, day } = await sessionsWithPlan(apiAs, testTag, 1);
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);

    // From the session on the calendar.
    await calendarPage.goto(day.url);
    const sheet = await calendarPage.openBlock(E2E_TRAINER_NAME, customer.fullName);
    await sheet.action(labels.bookings.openLog).click();
    await expect(
      page.getByRole("heading", { level: 1, name: fill(w.pageTitle, { customer: customer.fullName }) }),
    ).toBeVisible();

    // The planned session 1: the plan's line and the actual starting as the plan; Flag Normal, Action None.
    await expect(log.set(catalog.squat, 1)).toContainText(fill(w.planStrength, { weight: 40, reps: 10, rir: 3 }));
    await expect(log.actual(catalog.squat, 1, p.set.weight)).toHaveValue("40");
    await expect(log.actual(catalog.squat, 1, p.set.reps)).toHaveValue("10");
    await expect(log.actual(catalog.squat, 1, p.set.rir)).toHaveValue("3");
    await expect(log.choice(catalog.squat, 1, w.fields.flag)).toHaveText("Normal");
    await expect(log.choice(catalog.squat, 1, w.fields.action)).toHaveText("None");
    await expect(log.main.getByLabel(w.fields.goal, { exact: true })).toHaveValue("Làm quen");
    // A Cardio row has time, speed and heart rate and no weights.
    await expect(log.set(catalog.run, 1)).toContainText(
      fill(w.planCardio, { minutes: 15, speed: 8.5, heartRate: 130 }),
    );
    await expect(log.actual(catalog.run, 1, p.set.durationMinutes)).toHaveValue("15");
    await expect(log.actual(catalog.run, 1, p.set.speed)).toHaveValue("8.5");
    await expect(log.set(catalog.run, 1).getByLabel(`${fill(p.place.sets, { n: 1 })} · ${p.set.weight}`)).toHaveCount(
      0,
    );
    // The plan's rows cannot be removed.
    await expect(log.set(catalog.squat, 1).getByRole("button", { name: w.removeSet })).toHaveCount(0);

    // The coach changes only the differences.
    await log.actual(catalog.squat, 1, p.set.weight).fill("42,5");
    await log.actual(catalog.squat, 1, p.set.reps).fill("9");
    await log.pick(log.choice(catalog.squat, 1, w.fields.flag), "Stress");
    await log.pick(log.choice(catalog.squat, 1, w.fields.action), "Giảm tải");
    await log
      .set(catalog.squat, 1)
      .getByLabel(`${fill(p.place.sets, { n: 1 })} · ${w.fields.setNote}`)
      .fill("Đau gối nhẹ");
    await log.pick(log.field(w.fields.stress), "7");
    await log.pick(log.field(w.fields.energy), "4");
    await log.pick(log.field(w.fields.impact), "Cao");
    await log.pick(log.field(w.fields.srpe), "8");
    await log.pick(log.field(w.fields.energyAfter), "5");
    await log.pick(log.field(w.fields.summary), "Tốt hơn");
    await log.main.getByLabel(w.fields.coachNotes, { exact: true }).fill("Giữ mức tạ tuần sau");
    await log.save();
    await expect(notice(w.saved)).toBeVisible();

    // It is all kept, and the plan's line did not move.
    await page.reload();
    await expect(log.actual(catalog.squat, 1, p.set.weight)).toHaveValue("42.5");
    await expect(log.actual(catalog.squat, 1, p.set.reps)).toHaveValue("9");
    await expect(log.choice(catalog.squat, 1, w.fields.flag)).toHaveText("Stress");
    await expect(log.choice(catalog.squat, 1, w.fields.action)).toHaveText("Giảm tải");
    await expect(log.set(catalog.squat, 1)).toContainText(fill(w.planStrength, { weight: 40, reps: 10, rir: 3 }));
    await expect(log.field(w.fields.stress)).toHaveText("7");
    await expect(log.field(w.fields.impact)).toHaveText("Cao");
    await expect(log.field(w.fields.summary)).toHaveText("Tốt hơn");
    await expect(log.main.getByLabel(w.fields.coachNotes, { exact: true })).toHaveValue("Giữ mức tạ tuần sau");

    // AC-23: the screen fits a phone, with no sideways scrolling.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("filling in a log", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("takes Khác with a note, the coach's own exercises and sets, and the next session follows the plan", async ({
    page,
    apiAs,
    testTag,
    customerDetailPage,
    workoutLogPage: log,
  }) => {
    const { customer, catalog, bookings } = await sessionsWithPlan(apiAs, testTag);
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);
    const open = async (bookingId: string) => {
      const response = await (await apiAs("FITNESS_MANAGER")).post("/api/v1/workout/logs", { data: { bookingId } });
      expect(response.status()).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };

    await log.goto(await open(bookings[0]));
    // "Khác" needs a note, shown at once beside the choice and refused by the API without it.
    await log.pick(log.choice(catalog.squat, 1, w.fields.flag), OTHER_OPTION_LABEL);
    await log.save();
    await expect(log.problems).toContainText(labels.validation.otherNeedsNote);
    await log
      .set(catalog.squat, 1)
      .getByLabel(`${fill(p.place.sets, { n: 1 })} · ${w.fields.flag} · ${w.fields.otherNote}`)
      .fill("Đau vai");
    // An exercise of the coach's own, with a second set copied from the first and then taken out.
    await log.addExercise(testTag, catalog.press);
    await log.actual(catalog.press, 1, p.set.weight).fill("20");
    await log.exercise(catalog.press).getByRole("button", { name: w.addSet, exact: true }).click();
    await expect(log.actual(catalog.press, 2, p.set.weight)).toHaveValue("20");
    await log.set(catalog.press, 2).getByRole("button", { name: w.removeSet }).click();
    await expect(log.set(catalog.press, 2)).toHaveCount(0);
    await log.save();
    await expect(notice(w.saved)).toBeVisible();

    await page.reload();
    await expect(log.choice(catalog.squat, 1, w.fields.flag)).toHaveText(OTHER_OPTION_LABEL);
    await expect(log.exercise(catalog.press)).toBeVisible();
    await expect(log.exercise(catalog.press).getByText(w.addedByCoach)).toBeVisible();
    await expect(log.actual(catalog.press, 1, p.set.weight)).toHaveValue("20");

    // The next session follows the next planned session of the plan.
    await log.goto(await open(bookings[1]));
    await expect(log.main.getByLabel(w.fields.goal, { exact: true })).toHaveValue("Tăng tải");
    await expect(log.actual(catalog.squat, 1, p.set.weight)).toHaveValue("50");

    // Both logs are in the customer's profile.
    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.plans);
    await expect(
      customerDetailPage.tabPanel(labels.customers.tabs.plans).getByRole("link", { name: /.+/ }),
    ).not.toHaveCount(0);
    await expect(
      customerDetailPage
        .tabPanel(labels.customers.tabs.plans)
        .getByRole("region", { name: w.title })
        .getByRole("listitem"),
    ).toHaveCount(2);
  });
});

test.describe("who sees the logs", () => {
  test.describe("reception", () => {
    test.use(signedInAs("RECEPTIONIST"));

    test("has no logs", async ({ page, apiAs }) => {
      for (const path of ["/workouts/logs"]) {
        await page.goto(path);
        await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
      }
      expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/workout/logs")).status()).toBe(403);
    });
  });
});
