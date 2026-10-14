import { expect, signedInAs, test } from "./fixtures";
import { classSetup } from "./support/data";
import { fill, labels } from "./support/labels";

// The class schedule (M5.5, brief §6.4, D-031, BR-411; docs/13 E2E-110).
const c = labels.classes;

test.describe("classes as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-110: a customer is enrolled in a class, marked present, and one session is used", async ({
    page,
    apiAs,
    testTag,
    classesPage,
  }) => {
    const { customer, contract, gymClass, today } = await classSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const remaining = async () =>
      ((await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as { remainingSessions: number })
        .remainingSessions;
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);

    await classesPage.goto();
    const sheet = await classesPage.open(gymClass.name);
    await expect(sheet.seats).toHaveText(fill(c.seats, { taken: 0, capacity: 10 }));
    await sheet.enroll(customer.fullName, customer.customerCode);
    await expect(notice(c.enrolled)).toBeVisible();
    await expect(sheet.seat(customer.fullName)).toContainText(c.attendance.ENROLLED);
    await expect(sheet.seats).toHaveText(fill(c.seats, { taken: 1, capacity: 10 }));
    // Enrolling uses nothing yet.
    expect(await remaining()).toBe(12);

    await sheet.seat(customer.fullName).getByRole("button", { name: c.present, exact: true }).click();
    await expect(notice(c.markedPresent)).toBeVisible();
    await expect(sheet.seat(customer.fullName)).toContainText(c.attendance.PRESENT);
    // A mark is final: no more buttons on the seat.
    await expect(sheet.seat(customer.fullName).getByRole("button")).toHaveCount(0);
    expect(await remaining()).toBe(11);

    const session = (await (await admin.get(`/api/v1/class-sessions/${today.id}`)).json()) as {
      taught: boolean;
      present: number;
    };
    expect(session).toMatchObject({ taught: true, present: 1 });
  });

  test("a customer marked absent uses nothing and frees the seat", async ({ page, apiAs, testTag, classesPage }) => {
    const { customer, contract, gymClass, today } = await classSetup(apiAs, testTag, { capacity: 1 });
    const admin = await apiAs("ADMIN");
    const enrolled = await admin.post(`/api/v1/class-sessions/${today.id}/attendees`, {
      data: { customerId: customer.id, contractId: contract.id },
    });
    expect(enrolled.status()).toBe(201);

    await classesPage.goto();
    const sheet = await classesPage.open(gymClass.name);
    await sheet.seat(customer.fullName).getByRole("button", { name: c.absent, exact: true }).click();

    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(c.markedAbsent),
    ).toBeVisible();
    await expect(sheet.seat(customer.fullName)).toContainText(c.attendance.ABSENT);
    await expect(sheet.seats).toHaveText(fill(c.seats, { taken: 0, capacity: 1 }));
    const view = (await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as { remainingSessions: number };
    expect(view.remainingSessions).toBe(12);
  });

  test("a manager adds a class and it is listed with its days and time", async ({ apiAs, testTag, classesPage }) => {
    const admin = await apiAs("ADMIN");
    const me = (await (await admin.get("/api/v1/me")).json()) as { branches: { name: string }[] };
    const { createTrainerViaApi } = await import("./support/data");
    const coach = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), testTag);

    await classesPage.goto("manage");
    await classesPage.addClass({
      name: `Lớp ${testTag}`,
      branch: me.branches[0]!.name,
      coach: coach.fullName,
      capacity: 12,
      weekdays: [1, 3],
      startTime: "12:15",
      endTime: "13:15",
    });

    const row = classesPage.row(`Lớp ${testTag}`);
    await expect(row).toContainText(coach.fullName);
    await expect(row).toContainText("12:15–13:15");
    await expect(row).toContainText(c.weekdaysShort["1"]);
    await expect(row).toContainText(c.weekdaysShort["3"]);
    await expect(row).toContainText(c.on);
  });
});

test.describe("classes as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("reception enrolls customers but does not mark attendance or manage classes", async ({
    apiAs,
    testTag,
    classesPage,
  }) => {
    const { customer, contract, gymClass, today } = await classSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    await admin.post(`/api/v1/class-sessions/${today.id}/attendees`, {
      data: { customerId: customer.id, contractId: contract.id },
    });

    await classesPage.goto();
    const sheet = await classesPage.open(gymClass.name);
    await expect(sheet.seat(customer.fullName)).toContainText(c.attendance.ENROLLED);
    await expect(sheet.action(c.present)).toHaveCount(0);
    await expect(sheet.action(c.absent)).toHaveCount(0);
    await expect(sheet.root.getByRole("form", { name: c.enrollTitle })).toBeVisible();

    // The class definitions are the manager's.
    await classesPage.goto("manage");
    await expect(classesPage.row(gymClass.name)).toHaveCount(0);
    await expect(sheet.root).toBeHidden();
  });
});
