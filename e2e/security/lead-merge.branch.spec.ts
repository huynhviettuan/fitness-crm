// OWASP A01 data scope and branch access for M2 slice 5 (BR-202, D-014, D-017, A-065): the
// re-care list, inquiries, and merges between consultants and between branches. Each test
// makes a branch of its own with two consultants; such specs run in the "own-branch"
// project (playwright.config.ts).
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createUserViaApi, roleIdOf } from "../support/admin";
import { branchWithConsultants, createLeadViaApi, leadChannelId, uniquePhone } from "../support/data";
import { otherOptionId } from "../support/options";

async function mergeBody(api: APIRequestContext, mergedId: string) {
  return { mergedId, reasonId: await otherOptionId(api, "deleteReasons"), reasonNote: "Cùng một người" };
}

/** A lead of the branch, put in re-care by an admin (who sees every branch). */
async function recareLead(admin: APIRequestContext, data: { fullName: string; branchId: string }) {
  const lead = await createLeadViaApi(admin, { ...data, phone: uniquePhone() });
  const response = await admin.post(`/api/v1/leads/${lead.id}/status`, { data: { status: "NO_RESPONSE" } });
  expect(response.status()).toBe(200);
  return lead;
}

test.describe("A01 re-care and merge between consultants", () => {
  test("a consultant sees only their own leads in the list, cannot add an inquiry to, read, or merge another's lead", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { branchId, consultants } = await branchWithConsultants(admin, testTag);
    const mine = await createLeadViaApi(admin, { fullName: `Của A ${testTag}`, branchId });
    const owner = consultants.find((c) => c.id === mine.pic?.id)!;
    const strangerAccount = consultants.find((c) => c.id !== mine.pic?.id)!;
    // One sign-in only: the sign-in limit is shared by the whole run (20 a minute).
    const stranger = await apiSignedIn(strangerAccount.email, strangerAccount.password);
    expect((await admin.post(`/api/v1/leads/${mine.id}/status`, { data: { status: "NO_RESPONSE" } })).status()).toBe(
      200,
    );
    const other = await createLeadViaApi(admin, { fullName: `Của người kia ${testTag}`, branchId });
    expect(other.pic?.id).not.toBe(mine.pic?.id);

    // Re-care: the other consultant lists nothing of this one's, under both scopes; an admin sees whose it is.
    for (const scope of ["mine", "all"]) {
      const list = (await (await stranger.get(`/api/v1/leads/recare?scope=${scope}`)).json()) as {
        items: { id: string }[];
      };
      expect(
        list.items.map((row) => row.id),
        scope,
      ).not.toContain(mine.id);
    }
    const owned = (await (await admin.get(`/api/v1/leads/recare?scope=all&picUserId=${owner.id}`)).json()) as {
      items: { id: string }[];
    };
    expect(owned.items.map((row) => row.id)).toEqual([mine.id]);
    // The other consultant's record does not exist for them.
    const zalo = await leadChannelId(admin, "Zalo");
    expect((await stranger.post(`/api/v1/persons/${mine.id}/inquiries`, { data: { channelId: zalo } })).status()).toBe(
      404,
    );
    expect((await stranger.get(`/api/v1/persons/${mine.id}/intake-history`)).status()).toBe(404);
    // A consultant cannot merge at all (lead.merge).
    expect(
      (await stranger.post(`/api/v1/persons/${mine.id}/merge`, { data: await mergeBody(admin, other.id) })).status(),
    ).toBe(403);
    // The inquiry of someone who may see the record reaches the consultant in charge.
    expect((await admin.post(`/api/v1/persons/${mine.id}/inquiries`, { data: { channelId: zalo } })).status()).toBe(
      201,
    );
  });
});

test.describe("A01 re-care and merge between branches (D-014)", () => {
  test("a manager of another branch cannot see, add an inquiry to, or merge records they have no branch for; an admin of both can", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { branchId } = await branchWithConsultants(admin, testTag);
    const remoteManager = await createUserViaApi(admin, testTag, {
      roleId: await roleIdOf(admin, { code: "FITNESS_MANAGER" }),
      branchIds: [branchId],
      label: "Remote manager",
    });
    const remote = await apiSignedIn(remoteManager.email, remoteManager.password);
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");
    const here = await createLeadViaApi(reception, { fullName: `Ở đây ${testTag}`, phone: uniquePhone() });
    const there = await createLeadViaApi(admin, { fullName: `Ở kia ${testTag}`, branchId, phone: uniquePhone() });
    const inRecare = await recareLead(admin, {
      fullName: `Tái chăm sóc kia ${testTag}`,
      branchId,
    });
    const zalo = await leadChannelId(admin, "Zalo");

    // Re-care rows of another branch are invisible, in both directions.
    const seenByRemote = (await (await remote.get("/api/v1/leads/recare?scope=all")).json()) as {
      items: { id: string; branch: { id: string } }[];
    };
    expect(seenByRemote.items.every((row) => row.branch.id === branchId)).toBe(true);
    const seenByLocal = (await (await manager.get("/api/v1/leads/recare?scope=all")).json()) as {
      items: { id: string }[];
    };
    expect(seenByLocal.items.map((row) => row.id)).not.toContain(inRecare.id);

    // Records of the other branch are 404 for inquiries, history, and merging.
    expect((await remote.post(`/api/v1/persons/${here.id}/inquiries`, { data: { channelId: zalo } })).status()).toBe(
      404,
    );
    expect((await manager.post(`/api/v1/persons/${there.id}/inquiries`, { data: { channelId: zalo } })).status()).toBe(
      404,
    );
    expect((await manager.get(`/api/v1/persons/${there.id}/intake-history`)).status()).toBe(404);
    for (const api of [manager, remote]) {
      const refused = await api.post(`/api/v1/persons/${here.id}/merge`, { data: await mergeBody(admin, there.id) });
      expect(refused.status()).toBe(404);
    }
    expect((await admin.get(`/api/v1/leads/${here.id}`)).status()).toBe(200);
    expect((await admin.get(`/api/v1/leads/${there.id}`)).status()).toBe(200);

    // An admin with both branches merges; the survivor's branch is kept.
    const sharedBranch = ((await (await admin.get(`/api/v1/leads/${here.id}`)).json()) as { branch: { id: string } })
      .branch.id;
    const merged = await admin.post(`/api/v1/persons/${here.id}/merge`, { data: await mergeBody(admin, there.id) });
    expect(merged.status()).toBe(200);
    const { survivorId, mergedId } = (await merged.json()) as { survivorId: string; mergedId: string };
    const survivor = (await (await admin.get(`/api/v1/leads/${survivorId}`)).json()) as { branch: { id: string } };
    expect(survivor.branch.id).toBe(survivorId === here.id ? sharedBranch : branchId);
    expect((await admin.get(`/api/v1/leads/${mergedId}`)).status()).toBe(404);
  });

  test("a duplicate phone in another branch names nobody to a user without that branch", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { branchId } = await branchWithConsultants(admin, testTag);
    const phone = uniquePhone();
    await createLeadViaApi(admin, { fullName: `Ở kia ${testTag}`, branchId, phone });
    const reception = await apiAs("RECEPTIONIST");

    const local = await reception.post("/api/v1/leads/intake", {
      data: { fullName: `Trùng ${testTag}`, phone, channelId: await leadChannelId(reception, "Zalo") },
    });
    const ownBranch = await admin.post("/api/v1/leads/intake", {
      data: { fullName: `Trùng hai ${testTag}`, phone, branchId, channelId: await leadChannelId(reception, "Zalo") },
    });

    expect(local.status()).toBe(409);
    expect((await local.json()).details).not.toHaveProperty("duplicate");
    expect(ownBranch.status()).toBe(409);
    expect((await ownBranch.json()).details.duplicate).toMatchObject({ stage: "LEAD" });
  });
});
