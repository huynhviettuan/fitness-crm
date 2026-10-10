// OWASP A01 (access control, mass assignment), A06/A08 (duplicate submission), A10
// (input errors) for the contract routes added in Phase 2. Route-level 401s are covered
// by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { PT24, createContractViaApi, createCustomerViaApi } from "../support/data";
import type { Role } from "../../src/lib/permissions";

test.describe("A01 contract roles (docs/09, A-015)", () => {
  const createExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["MANAGER", 201],
    ["RECEPTIONIST", 201],
    ["TRAINER", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of createExpectations) {
    test(`${role} creating a contract gets ${status}`, async ({ apiAs, testTag }) => {
      const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
      const api = await apiAs(role);
      const response = await api.post(`/api/v1/customers/${customer.id}/contracts`, {
        headers: { "idempotency-key": randomUUID() },
        data: PT24,
      });
      expect(response.status()).toBe(status);
    });
  }

  const cancelExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    ["ACCOUNTANT", 403],
    ["TRAINER", 403],
    ["MANAGER", 200],
  ];
  for (const [role, status] of cancelExpectations) {
    test(`${role} cancelling a contract gets ${status}`, async ({ apiAs, testTag }) => {
      const reception = await apiAs("RECEPTIONIST");
      const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id, { activate: true });

      const response = await (await apiAs(role)).post(`/api/v1/contracts/${contract.id}/cancel`);
      expect(response.status()).toBe(status);
    });
  }

  test("a trainer cannot open a contract by its real id (OQ-006 interim)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id);

    expect((await (await apiAs("TRAINER")).get(`/api/v1/contracts/${contract.id}`)).status()).toBe(404);
  });

  test("status, code, and opening balances cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    const response = await reception.post(`/api/v1/customers/${customer.id}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: { ...PT24, status: "ACTIVE", contractCode: "HD999999", openingSessionsUsed: 20, openingPaidAmount: 12_000_000 },
    });

    expect(await response.json()).toMatchObject({
      status: "DRAFT",
      contractCode: expect.not.stringMatching(/^HD999999$/),
      openingSessionsUsed: 0,
      openingPaidAmount: 0,
      remainingSessions: 24,
      debt: 12_000_000,
    });
  });
});

test.describe("A06/A08 duplicate submission (T-015)", () => {
  test("a create without an Idempotency-Key is refused", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    const response = await reception.post(`/api/v1/customers/${customer.id}/contracts`, { data: PT24 });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  test("a replay returns the original with 200; reusing the key for other content is 409", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const headers = { "idempotency-key": randomUUID() };
    const url = `/api/v1/customers/${customer.id}/contracts`;

    const first = await reception.post(url, { headers, data: PT24 });
    const replay = await reception.post(url, { headers, data: PT24 });
    const misuse = await reception.post(url, { headers, data: { ...PT24, totalSessions: "12" } });

    expect(first.status()).toBe(201);
    expect(replay.status()).toBe(200);
    expect((await replay.json()).id).toBe((await first.json()).id);
    expect(misuse.status()).toBe(409);
    expect(await misuse.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await (await reception.get(url)).json()).total).toBe(1);
  });
});

test.describe("A10 contract input errors", () => {
  test("invalid fields return the documented error with field keys", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    const response = await reception.post(`/api/v1/customers/${customer.id}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: { packageName: "", contractValue: "12,5", totalSessions: "0", startDate: "31/02/2026", endDate: "x" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fieldErrors: {
          packageName: ["required"],
          contractValue: ["invalidAmount"],
          totalSessions: ["invalidNumber"],
          startDate: ["invalidDate"],
          endDate: ["invalidDate"],
        },
      },
    });
  });

  test("an active contract cannot be edited, and an unknown customer is 404", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id, { activate: true });

    const edit = await reception.patch(`/api/v1/contracts/${contract.id}`, { data: PT24 });
    expect(edit.status()).toBe(409);
    expect(await edit.json()).toMatchObject({ code: "CONTRACT_NOT_EDITABLE" });

    const unknown = await reception.post(`/api/v1/customers/${randomUUID()}/contracts`, {
      headers: { "idempotency-key": randomUUID() },
      data: PT24,
    });
    expect(unknown.status()).toBe(404);
  });
});
