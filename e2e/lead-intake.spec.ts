import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, uniquePhone } from "./support/data";
import { setLeadPic } from "./support/db";
import { fill, labels } from "./support/labels";

// M2.7 step 1 (the owner's answers of 12/10/2026): a lead needs a name and a channel only (D-060), the
// nationality is a country (D-057), and a returning person's lead that someone else has is not a dead end.
const l = labels.leads;

test.describe("as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("a lead is added with a name and a channel only, no phone", async ({ leadsPage, leadPage, testTag }) => {
    const name = `Chưa có số ${testTag}`;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: name, channel: "Zalo" });
    await form.save();

    await expect(leadPage.heading(name)).toBeVisible();
  });

  test("the nationality is chosen from the countries, and the lead shows its name", async ({
    leadsPage,
    leadPage,
    testTag,
  }) => {
    const name = `Khách Hàn ${testTag}`;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: name, channel: "Zalo" });
    await form.showMore();
    await form.choose(l.fields.country, "Hàn Quốc");
    await form.save();

    await expect(leadPage.heading(name)).toBeVisible();
    await expect(leadPage.detail(l.need, l.fields.country)).toHaveText("Hàn Quốc");
  });
});

test.describe("as a consultant", () => {
  test.use(signedInAs("CONSULTING"));

  test("a phone that belongs to a lead in someone else's charge says who has it, with no way into it", async ({
    apiAs,
    leadsPage,
    testTag,
  }) => {
    const phone = uniquePhone();
    const existing = await createLeadViaApi(await apiAs("RECEPTIONIST"), {
      fullName: `Của người khác ${testTag}`,
      phone,
    });
    const manager = (await (await (await apiAs("FITNESS_MANAGER")).get("/api/v1/me")).json()) as {
      id: string;
      name: string;
    };
    await setLeadPic(existing.id, manager.id);

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: `Quay lại ${testTag}`, phone, channel: "Zalo" });
    await form.save();

    const notice = form.root.getByRole("alert").filter({
      hasText: fill(labels.people.duplicateElsewhere, {
        code: existing.leadCode,
        name: existing.fullName,
        person: manager.name,
      }),
    });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link")).toHaveCount(0);
    // No dialog offers to add the inquiry to a record the user cannot open.
    await expect(form.root.page().getByRole("alertdialog")).toHaveCount(0);
  });
});
