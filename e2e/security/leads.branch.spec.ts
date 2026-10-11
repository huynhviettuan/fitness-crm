// OWASP A01 data scope for leads between consultants (D-017, D-019, D-020). Each test makes
// a branch of its own with two consultants; such specs run in the "own-branch" project
// (playwright.config.ts).
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { branchWithConsultants, createLeadViaApi, uniquePhone } from "../support/data";

async function whatsApp(api: APIRequestContext): Promise<string> {
  const options = (await (await api.get("/api/v1/option-lists/leadChannels/options")).json()) as {
    items: { id: string; labelVi: string }[];
  };
  return options.items.find((option) => option.labelVi === "WhatsApp")!.id;
}

test.describe("A01 leads between consultants", () => {
  test("a consultant cannot open or work another consultant's lead, and a lead is not reachable as a customer", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { branchId, consultants } = await branchWithConsultants(admin, testTag);
    const lead = await createLeadViaApi(admin, { fullName: `Lead ${testTag}`, branchId });
    const other = consultants.find((c) => c.id !== lead.pic?.id)!;
    const consulting = await apiSignedIn(other.email, other.password);

    expect((await consulting.get(`/api/v1/leads/${lead.id}`)).status()).toBe(404);
    expect(
      (
        await consulting.patch(`/api/v1/leads/${lead.id}`, {
          data: { fullName: "X", channelId: await whatsApp(admin) },
        })
      ).status(),
    ).toBe(404);
    expect((await consulting.get(`/api/v1/leads/${lead.id}/timeline`)).status()).toBe(404);
    expect(
      (await consulting.post(`/api/v1/leads/${lead.id}/status`, { data: { status: "CONSIDERING" } })).status(),
    ).toBe(404);
    expect((await consulting.get(`/api/v1/leads/${lead.id}/assignees`)).status()).toBe(403);
    expect((await consulting.post(`/api/v1/leads/${lead.id}/assign`, { data: { userId: other.id } })).status()).toBe(
      403,
    );
    const board = (await (await consulting.get(`/api/v1/leads/board?q=${testTag}`)).json()) as {
      columns: { items: unknown[] }[];
    };
    expect(board.columns.flatMap((column) => column.items)).toEqual([]);
    expect((await admin.get(`/api/v1/customers/${lead.id}`)).status()).toBe(404);
  });

  test("a duplicate phone names the existing record only to someone who may see it (D-019)", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const phone = uniquePhone();
    const first = await (
      await reception.post("/api/v1/leads", {
        data: { fullName: `Lead ${testTag}`, phone, channelId: await whatsApp(reception) },
      })
    ).json();

    const again = await reception.post("/api/v1/leads", {
      data: { fullName: `Lead 2 ${testTag}`, phone, channelId: await whatsApp(reception) },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({
      code: "PHONE_ALREADY_USED",
      details: { duplicate: { id: first.id, stage: "LEAD" } },
    });

    // A consultant of another branch may not see the first lead.
    const { consultants } = await branchWithConsultants(await apiAs("ADMIN"), testTag);
    const consulting = await apiSignedIn(consultants[0].email, consultants[0].password);
    const hidden = await consulting.post("/api/v1/leads", {
      data: { fullName: `Lead 3 ${testTag}`, phone, channelId: await whatsApp(reception) },
    });
    expect(hidden.status()).toBe(409);
    expect((await hidden.json()).details).not.toHaveProperty("duplicate");
  });
});
