import { expect, signedInAs, test } from "./fixtures";
import { createOptionViaApi } from "./support/options";
import { labels } from "./support/labels";

// M2.7 step 2 (the owner's answers of 12/10/2026): the direct manager of an employee (D-046) and the coded
// catalog of need details (D-066). Who is told of a slow approval is in the integration tests.
const e = labels.employees;
const l = labels.leads;

test.describe("as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("an employee's direct manager is chosen from the other employees and shown on the record", async ({
    apiAs,
    employeesPage,
    employeePage,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const boss = (await (
      await manager.post("/api/v1/employees", { data: { fullName: `Trưởng nhóm ${testTag}` } })
    ).json()) as { id: string; employeeCode: string; fullName: string };
    await manager.post("/api/v1/employees", { data: { fullName: `Nhân viên ${testTag}` } });

    await employeesPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await employeesPage.open(`Nhân viên ${testTag}`);
    await expect(employeePage.detail(e.fields.manager)).toHaveText(e.noManager);
    const dialog = await employeePage.editDetails();
    await dialog.chooseManager(`${boss.employeeCode} · ${boss.fullName}`);
    await dialog.save();

    await expect(employeePage.detail(e.fields.manager)).toHaveText(`${boss.employeeCode} · ${boss.fullName}`);
  });

  test("the employee cannot be offered as their own manager", async ({
    apiAs,
    employeesPage,
    employeePage,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const own = (await (
      await manager.post("/api/v1/employees", { data: { fullName: `Một mình ${testTag}` } })
    ).json()) as {
      employeeCode: string;
      fullName: string;
    };

    await employeesPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await employeesPage.open(`Một mình ${testTag}`);
    const dialog = await employeePage.editDetails();
    await dialog.root.getByRole("combobox", { name: e.fields.manager, exact: true }).click();

    await expect(dialog.root.page().getByRole("listbox").getByRole("option", { name: e.noManager })).toBeVisible();
    await expect(
      dialog.root
        .page()
        .getByRole("listbox")
        .getByRole("option", { name: `${own.employeeCode} · ${own.fullName}` }),
    ).toHaveCount(0);
  });
});

test.describe("as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("a lead's need detail is chosen from the coded catalog, read by its number, with a note", async ({
    apiAs,
    leadsPage,
    leadPage,
    testTag,
  }) => {
    const code = `ND${testTag.slice(-6).toUpperCase()}`;
    await createOptionViaApi(await apiAs("ADMIN"), "needDetails", `Giảm mỡ bụng ${testTag}`, code);
    const name = `Khách có mã ${testTag}`;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: name, channel: "Zalo" });
    await form.showMore();
    await form.choose(l.fields.needDetailChoice, `${code} · Giảm mỡ bụng ${testTag}`);
    await form.field(l.fields.needDetail).fill("Sau sinh 6 tháng");
    await form.save();

    await expect(leadPage.heading(name)).toBeVisible();
    await expect(leadPage.detail(l.need, l.fields.needDetail)).toHaveText(
      `${code} · Giảm mỡ bụng ${testTag}: Sau sinh 6 tháng`,
    );
  });
});
