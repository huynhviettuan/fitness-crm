// OWASP A01 (access control, mass assignment), A06/A08 (duplicate submission), A10
// (input errors) for the contract routes added in Phase 2. Route-level 401s are covered
// by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { contractPayload, createContractViaApi, createCustomerViaApi } from "../support/data";
import type { Role } from "../support/db";

test.describe("A01 contract roles (docs/09, A-015)", () => {
  const createExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["FITNESS_MANAGER", 201],
    ["CONSULTING", 201],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of createExpectations) {
    test(`${role} creating a contract gets ${status}`, async ({ apiAs, testTag }) => {
      // A consultant sees only customers they created (A-029), so they create this one.
      const customer = await createCustomerViaApi(
        await apiAs(role === "CONSULTING" ? "CONSULTING" : "RECEPTIONIST"),
        testTag,
      );
      const api = await apiAs(role);
      const response = await api.post(`/api/v1/customers/${customer.id}/contracts`, {
        headers: { "idempotency-key": randomUUID() },
        data: await contractPayload(),
      });
      expect(response.status()).toBe(status);
    });
  }

  const cancelExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    ["ACCOUNTANT", 403],
    ["PT", 403],
    ["FITNESS_MANAGER", 200],
  ];
  for (const [role, status] of cancelExpectations) {
    test(`${role} cancelling a contract gets ${status}`, async ({ apiAs, testTag }) => {
      const reception = await apiAs("RECEPTIONIST");
      const contract = await createContractViaApi(
        await apiAs("FITNESS_MANAGER"),
        (await createCustomerViaApi(reception, testTag)).id,
        { activateWith: await apiAs("ADMIN") },
      );

      const response = await (await apiAs(role)).post(`/api/v1/contracts/${contract.id}/cancel`);
      expect(response.status()).toBe(status);
    });
  }

  test("a trainer cannot open a contract by its real id (OQ-006 interim)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(
      await apiAs("FITNESS_MANAGER"),
      (await createCustomerViaApi(reception, testTag)).id,
    );

    expect((await (await apiAs("PT")).get(`/api/v1/contracts/${contract.id}`)).status()).toBe(404);
  });

  test("status, code, and opening balances cannot be set by the client (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(seller, testTag);

    const response = await seller.post(`/api/v1/customers/${customer.id}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: await contractPayload({
        status: "ACTIVE",
        contractCode: "HD999999",
        openingSessionsUsed: 20,
        openingPaidAmount: 12_000_000,
        // The price is the tier's, whatever the client says (BR-301).
        unitPrice: 1,
        contractValue: 1,
        packageName: "Hack",
      }),
    });

    expect(await response.json()).toMatchObject({
      status: "DRAFT",
      contractCode: expect.not.stringMatching(/^HD999999$/),
      openingSessionsUsed: 0,
      openingPaidAmount: 0,
      remainingSessions: 24,
      debt: 12_000_000,
      packageName: "PT 24 buổi",
    });
  });
});

test.describe("A06/A08 duplicate submission (T-015)", () => {
  test("a create without an Idempotency-Key is refused", async ({ apiAs, testTag }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(seller, testTag);

    const response = await seller.post(`/api/v1/customers/${customer.id}/contracts`, { data: await contractPayload() });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  test("a replay returns the original with 200; reusing the key for other content is 409", async ({
    apiAs,
    testTag,
  }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(seller, testTag);
    const headers = { "idempotency-key": randomUUID() };
    const url = `/api/v1/customers/${customer.id}/contracts`;

    const payload = await contractPayload();
    const first = await seller.post(url, { headers, data: payload });
    const replay = await seller.post(url, { headers, data: payload });
    const misuse = await seller.post(url, { headers, data: { ...payload, sessions: 12 } });

    expect(first.status()).toBe(201);
    expect(replay.status()).toBe(200);
    expect((await replay.json()).id).toBe((await first.json()).id);
    expect(misuse.status()).toBe(409);
    expect(await misuse.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await (await seller.get(url)).json()).total).toBe(1);
  });
});

test.describe("A10 contract input errors", () => {
  test("invalid fields return the documented error with field keys", async ({ apiAs, testTag }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(seller, testTag);

    const response = await seller.post(`/api/v1/customers/${customer.id}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: { serviceId: "x", sessions: "0", contractDate: "31/02/2026", vatPercent: "101" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fieldErrors: {
          serviceId: ["invalidChoice"],
          sessions: ["invalidNumber"],
          contractDate: ["invalidDate"],
          vatPercent: ["invalidPercent"],
        },
      },
    });
  });

  test("an active contract cannot be edited, and an unknown customer is 404", async ({ apiAs, testTag }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const contract = await createContractViaApi(
      await apiAs("FITNESS_MANAGER"),
      (await createCustomerViaApi(seller, testTag)).id,
      { activateWith: await apiAs("ADMIN") },
    );

    const edit = await seller.patch(`/api/v1/contracts/${contract.id}`, { data: await contractPayload() });
    expect(edit.status()).toBe(409);
    expect(await edit.json()).toMatchObject({ code: "CONTRACT_NOT_EDITABLE" });

    const unknown = await seller.post(`/api/v1/customers/${randomUUID()}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: await contractPayload(),
    });
    expect(unknown.status()).toBe(404);
  });

  test("approving, rejecting, unapproving, and deleting are for their roles only (M4.4a, D-018, A-124, A-125)", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(reception, testTag);
    const pending = await createContractViaApi(seller, customer.id);
    const reason = { reasonId: randomUUID() };

    // No permission: 403. Nobody decides their own contract: 403 for the seller too.
    for (const role of ["RECEPTIONIST", "PT", "ACCOUNTANT", "CONSULTING"] as const) {
      const api = await apiAs(role);
      expect((await api.post(`/api/v1/contracts/${pending.id}/activate`)).status()).toBe(403);
      expect((await api.post(`/api/v1/contracts/${pending.id}/reject`, { data: reason })).status()).toBe(403);
    }
    expect((await seller.post(`/api/v1/contracts/${pending.id}/activate`)).status()).toBe(403);

    // Unapproving and deleting are Admin's: a Fitness Manager gets 403 whatever the contract.
    expect((await seller.post(`/api/v1/contracts/${pending.id}/unapprove`, { data: reason })).status()).toBe(403);
    expect((await seller.delete(`/api/v1/contracts/${pending.id}`, { data: reason })).status()).toBe(403);
  });

  test("a reason is required to reject, unapprove, or delete, and an unknown contract is 404", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id);

    for (const response of [
      await admin.post(`/api/v1/contracts/${contract.id}/reject`, { data: {} }),
      await admin.post(`/api/v1/contracts/${contract.id}/unapprove`, { data: {} }),
      await admin.delete(`/api/v1/contracts/${contract.id}`, { data: {} }),
    ]) {
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    const unknown = randomUUID();
    expect((await admin.post(`/api/v1/contracts/${unknown}/activate`)).status()).toBe(404);
    expect((await admin.delete(`/api/v1/contracts/${unknown}`, { data: { reasonId: randomUUID() } })).status()).toBe(
      404,
    );
  });

  test("the note is for whoever may create contracts, the list refuses a wrong filter, and a stranger gets no history (M4.4b)", async ({
    apiAs,
    testTag,
  }) => {
    const seller = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(seller, customer.id, { activateWith: await apiAs("ADMIN") });

    // Approved, and the note still changes — for those who create contracts, not for the others.
    expect((await seller.patch(`/api/v1/contracts/${contract.id}/note`, { data: { notes: "Ghi chú" } })).status()).toBe(
      200,
    );
    for (const role of ["RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const api = await apiAs(role);
      expect((await api.patch(`/api/v1/contracts/${contract.id}/note`, { data: { notes: "x" } })).status()).toBe(403);
    }
    expect((await seller.patch(`/api/v1/contracts/${contract.id}/note`, { data: { notes: "a b" } })).status()).toBe(400);

    const wrong = await seller.get("/api/v1/contracts?status=NOPE");
    expect(wrong.status()).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "VALIDATION_FAILED" });

    // The history is the contract's: a trainer who cannot open the contract cannot read its history either.
    expect((await (await apiAs("PT")).get(`/api/v1/contracts/${contract.id}/history`)).status()).toBe(404);
    expect((await seller.get(`/api/v1/contracts/${contract.id}/history`)).status()).toBe(200);
  });

  test("deactivating and reactivating are Admin's, need a reason, and refuse a wrong choice (M4.6, D-023)", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: admin,
    });
    const body = { reasonId: randomUUID(), reasonNote: "x", extension: "NONE" };

    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT", "CONSULTING"] as const) {
      const api = await apiAs(role);
      expect((await api.post(`/api/v1/contracts/${contract.id}/deactivate`, { data: body })).status()).toBe(403);
      expect((await api.post(`/api/v1/contracts/${contract.id}/reactivate`, { data: body })).status()).toBe(403);
    }
    for (const path of ["deactivate", "reactivate"]) {
      const response = await admin.post(`/api/v1/contracts/${contract.id}/${path}`, { data: {} });
      expect(response.status()).toBe(400);
    }
    const wrongChoice = await admin.post(`/api/v1/contracts/${contract.id}/reactivate`, {
      data: { ...body, extension: "SOME" },
    });
    expect(wrongChoice.status()).toBe(400);
    expect((await admin.post(`/api/v1/contracts/${randomUUID()}/deactivate`, { data: body })).status()).toBe(404);
  });
});
