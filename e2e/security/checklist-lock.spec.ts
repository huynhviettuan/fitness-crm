// OWASP A01 (access control, data scope), A04 (the lock cannot be got around), and A10 (input errors) for
// M2.7 step 4: removing a tick and the locked step (D-054). Route-level 401s and 403s for every operation
// are also walked by permissions.spec.ts and access-control.spec.ts.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createLeadViaApi } from "../support/data";
import { setStepDue, type Role } from "../support/db";
import { otherOptionId } from "../support/options";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const NOBODY = "00000000-0000-4000-8000-0000000000ee";

type Items = { items: { id: string; key: string; state: string }[] };
const firstStep = async (api: APIRequestContext, leadId: string) =>
  ((await (await api.get(`/api/v1/leads/${leadId}/steps`)).json()) as Items).items.find(
    (item) => item.key === "tu-van",
  )!;

/** A lead whose first step is ticked by the E2E consultant. */
async function ticked(apiAs: (role: Role) => Promise<APIRequestContext>, name: string) {
  const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: name });
  const consultant = await apiAs("CONSULTING");
  const step = await firstStep(consultant, lead.id);
  expect(
    (
      await consultant.post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, { data: { resultIndex: 0 } })
    ).status(),
  ).toBe(200);
  return { lead, step };
}

test.describe("A01 who removes a tick (D-054)", () => {
  for (const role of ROLES) {
    const may = role === "ADMIN";
    test(`${role} removing a tick gets ${may ? "200" : "403"}`, async ({ apiAs, testTag }) => {
      const { lead, step } = await ticked(apiAs, `Gỡ ${role} ${testTag}`);
      const reasonId = await otherOptionId(await apiAs("ADMIN"), "stepReopenReasons");

      const response = await (
        await apiAs(role)
      ).post(`/api/v1/leads/${lead.id}/steps/${step.id}/reopen`, {
        data: { reasonId, reasonNote: "Tick nhầm" },
      });

      expect(response.status()).toBe(may ? 200 : 403);
      if (!may) {
        expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
        expect((await firstStep(await apiAs("CONSULTING"), lead.id)).state).toBe("DONE");
      } else {
        expect((await firstStep(await apiAs("ADMIN"), lead.id)).state).toBe("OPEN");
      }
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const response = await (
      await apiAs(null)
    ).post(`/api/v1/leads/${NOBODY}/steps/${NOBODY}/reopen`, {
      data: { reasonId: NOBODY },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("A10 input errors and the lock", () => {
  test("the reason is needed, comes from its own list, and Khác needs its note", async ({ apiAs, testTag }) => {
    const { lead, step } = await ticked(apiAs, `Lý do ${testTag}`);
    const admin = await apiAs("ADMIN");
    const url = `/api/v1/leads/${lead.id}/steps/${step.id}/reopen`;

    const none = await admin.post(url, { data: {} });
    expect(none.status()).toBe(400);
    expect((await none.json()).details.fieldErrors).toHaveProperty("reasonId");
    const noNote = await admin.post(url, { data: { reasonId: await otherOptionId(admin, "stepReopenReasons") } });
    expect(noNote.status()).toBe(400);
    expect((await noNote.json()).details.fieldErrors).toHaveProperty("reasonNote");
    const wrongList = await admin.post(url, {
      data: { reasonId: await otherOptionId(admin, "leadChannels"), reasonNote: "x" },
    });
    expect(wrongList.status()).toBe(400);
    expect((await wrongList.json()).details.fieldErrors).toHaveProperty("reasonId");
    expect((await firstStep(admin, lead.id)).state).toBe("DONE");
  });

  test("an unknown or malformed lead or step is 404, another lead's step too, and a step not done is 409", async ({
    apiAs,
    testTag,
  }) => {
    const { lead, step } = await ticked(apiAs, `Ngoài ${testTag}`);
    const other = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Khác ${testTag}` });
    const admin = await apiAs("ADMIN");
    const data = { reasonId: await otherOptionId(admin, "stepReopenReasons"), reasonNote: "x" };
    const post = async (leadId: string, stepId: string) =>
      (await admin.post(`/api/v1/leads/${leadId}/steps/${stepId}/reopen`, { data })).status();

    expect(await post(NOBODY, step.id)).toBe(404);
    expect(await post("not-a-uuid", step.id)).toBe(404);
    expect(await post(lead.id, NOBODY)).toBe(404);
    expect(await post(lead.id, "not-a-uuid")).toBe(404);
    // A step of another lead is not reachable through this one.
    expect(await post(other.id, step.id)).toBe(404);
    // The other lead's first step is not done.
    expect(await post(other.id, (await firstStep(admin, other.id)).id)).toBe(409);
  });

  test("a step past its grace period is locked, and the API says so: 409 STEP_LOCKED, not a late tick", async ({
    apiAs,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Khóa ${testTag}` });
    await setStepDue(lead.id, "tu-van", 300);
    const consultant = await apiAs("CONSULTING");
    const step = await firstStep(consultant, lead.id);

    const response = await consultant.post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, {
      data: { resultIndex: 0, doneAt: "2020-01-01T00:00:00Z", timing: "ON_TIME" },
    });

    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STEP_LOCKED" });
    // The time of a tick is the server's: a client-sent time or timing changes nothing, and the lock stays.
    expect((await firstStep(consultant, lead.id)).state).toBe("NOT_DONE");
    const retry = await consultant.post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, {
      data: { resultIndex: 0 },
    });
    expect(retry.status()).toBe(409);
  });

  test("a locked step cannot be removed either: it was never ticked", async ({ apiAs, testTag }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Khóa gỡ ${testTag}` });
    await setStepDue(lead.id, "tu-van", 300);
    const consultant = await apiAs("CONSULTING");
    const step = await firstStep(consultant, lead.id);
    await consultant.post(`/api/v1/leads/${lead.id}/steps/${step.id}/complete`, { data: { resultIndex: 0 } });
    const admin = await apiAs("ADMIN");

    const response = await admin.post(`/api/v1/leads/${lead.id}/steps/${step.id}/reopen`, {
      data: { reasonId: await otherOptionId(admin, "stepReopenReasons"), reasonNote: "x" },
    });

    expect(response.status()).toBe(409);
    expect((await firstStep(admin, lead.id)).state).toBe("NOT_DONE");
  });
});
