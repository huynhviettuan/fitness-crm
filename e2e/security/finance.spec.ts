// OWASP A01 (access control, mass assignment), A06/A08 (duplicate submission), A10
// (input errors) for the payment and cash routes added in Phase 4. Route-level 401s
// are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { createContractViaApi, createCustomerViaApi, gymToday, recordPaymentViaApi } from "../support/data";
import type { Role } from "../../src/lib/permissions";

const PAYMENT = { amount: "1.000.000", method: "CASH", paidOn: gymToday().date };

async function activeContract(apiAs: (role: Role) => Promise<import("@playwright/test").APIRequestContext>, tag: string) {
  const reception = await apiAs("RECEPTIONIST");
  return createContractViaApi(reception, (await createCustomerViaApi(reception, tag)).id, { activate: true });
}

test.describe("A01 finance roles (docs/09, A-021)", () => {
  const recordExpectations: [Role, number][] = [
    ["ADMIN", 201],
    ["MANAGER", 201],
    ["RECEPTIONIST", 201],
    ["ACCOUNTANT", 201],
    ["TRAINER", 403],
  ];
  for (const [role, status] of recordExpectations) {
    test(`${role} recording a payment gets ${status}`, async ({ apiAs, testTag }) => {
      const contract = await activeContract(apiAs, testTag);
      const response = await (await apiAs(role)).post(`/api/v1/contracts/${contract.id}/payments`, {
        headers: { "idempotency-key": randomUUID() },
        data: PAYMENT,
      });
      expect(response.status()).toBe(status);
    });
  }

  const voidExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    // E2E-009 (part 2): a trainer cannot void payments.
    ["TRAINER", 403],
    ["ACCOUNTANT", 200],
  ];
  for (const [role, status] of voidExpectations) {
    test(`${role} voiding a payment gets ${status}`, async ({ apiAs, testTag }) => {
      const contract = await activeContract(apiAs, testTag);
      const payment = await recordPaymentViaApi(await apiAs("RECEPTIONIST"), contract.id, "1.000.000");

      const response = await (await apiAs(role)).post(`/api/v1/payments/${payment.id}/void`, { data: { reason: "Kiểm tra" } });
      expect(response.status()).toBe(status);
    });
  }

  const cashExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    ["TRAINER", 403],
    ["ACCOUNTANT", 201],
  ];
  for (const [role, status] of cashExpectations) {
    test(`${role} recording income gets ${status}`, async ({ apiAs, testTag }) => {
      const response = await (await apiAs(role)).post("/api/v1/cash-transactions", {
        headers: { "idempotency-key": randomUUID() },
        data: { type: "INCOME", category: `Bán nước ${testTag}`, amount: "100.000", occurredOn: gymToday().date },
      });
      expect(response.status()).toBe(status);
    });
  }

  test("a trainer cannot read a contract's payments or the cash book", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const trainer = await apiAs("TRAINER");

    expect((await trainer.get(`/api/v1/contracts/${contract.id}/payments`)).status()).toBe(403);
    expect((await trainer.get("/api/v1/cash-transactions")).status()).toBe(403);
  });

  test("status, contract, and recorder cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const other = await activeContract(apiAs, `${testTag}b`);
    const reception = await apiAs("RECEPTIONIST");

    const response = await reception.post(`/api/v1/contracts/${contract.id}/payments`, {
      headers: { "idempotency-key": randomUUID() },
      data: { ...PAYMENT, status: "VOIDED", contractId: other.id, createdById: randomUUID(), voidReason: "x" },
    });

    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ status: "CONFIRMED", contract: { id: contract.id }, voidReason: null });
    expect((await (await reception.get(`/api/v1/contracts/${other.id}`)).json()).paidAmount).toBe(0);
  });
});

test.describe("A06/A08 duplicate submission (T-015)", () => {
  test("a replay returns the original, and only one payment counts (INT-004)", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const send = (key: string, amount = PAYMENT.amount) =>
      reception.post(`/api/v1/contracts/${contract.id}/payments`, { headers: { "idempotency-key": key }, data: { ...PAYMENT, amount } });
    const key = randomUUID();

    const first = await send(key);
    const second = await send(key);

    expect([first.status(), second.status()]).toEqual([201, 200]);
    expect((await second.json()).id).toBe((await first.json()).id);

    // INT-005: the same key with another amount.
    const reused = await send(key, "2.000.000");
    expect(reused.status()).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    expect((await (await reception.get(`/api/v1/contracts/${contract.id}`)).json()).paidAmount).toBe(1_000_000);
  });

  test("five copies sent at once record one payment", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        reception.post(`/api/v1/contracts/${contract.id}/payments`, { headers: { "idempotency-key": key }, data: PAYMENT }),
      ),
    );

    expect(responses.map((r) => r.status()).sort()).toEqual([200, 200, 200, 200, 201]);
    expect((await (await reception.get(`/api/v1/contracts/${contract.id}`)).json()).paidAmount).toBe(1_000_000);
  });

  test("a payment without an Idempotency-Key is refused", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);

    const response = await (await apiAs("RECEPTIONIST")).post(`/api/v1/contracts/${contract.id}/payments`, { data: PAYMENT });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });
});

test.describe("A10 finance input errors", () => {
  test("invalid amounts, methods, and dates are field errors", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const [d, m, y] = gymToday().date.split("/").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
    const tomorrowText = `${String(tomorrow.getUTCDate()).padStart(2, "0")}/${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}/${tomorrow.getUTCFullYear()}`;
    const send = (data: object) =>
      reception.post(`/api/v1/contracts/${contract.id}/payments`, { headers: { "idempotency-key": randomUUID() }, data });

    const invalid = await send({ amount: "12.5", method: "GOLD", paidOn: "2026-10-10" });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({
      details: { fieldErrors: { amount: ["invalidAmount"], method: ["invalidChoice"], paidOn: ["invalidDate"] } },
    });
    expect(await (await send({ ...PAYMENT, amount: "0" })).json()).toMatchObject({ details: { fieldErrors: { amount: ["amountNotPositive"] } } });
    expect(await (await send({ ...PAYMENT, paidOn: tomorrowText })).json()).toMatchObject({ details: { fieldErrors: { paidOn: ["futureDate"] } } });
  });

  test("business rules answer with their documented codes", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const send = (contractId: string, amount: string) =>
      reception.post(`/api/v1/contracts/${contractId}/payments`, { headers: { "idempotency-key": randomUUID() }, data: { ...PAYMENT, amount } });

    const over = await send(contract.id, "12.000.001");
    expect(over.status()).toBe(422);
    expect(await over.json()).toMatchObject({ code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" });

    await (await apiAs("MANAGER")).post(`/api/v1/contracts/${contract.id}/cancel`);
    const cancelled = await send(contract.id, "1.000.000");
    expect(cancelled.status()).toBe(409);
    expect(await cancelled.json()).toMatchObject({ code: "PAYMENT_CONTRACT_CANCELLED" });
  });

  test("a void needs a reason, and unknown ids are 404", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const payment = await recordPaymentViaApi(await apiAs("RECEPTIONIST"), contract.id, "1.000.000");
    const accountant = await apiAs("ACCOUNTANT");

    const noReason = await accountant.post(`/api/v1/payments/${payment.id}/void`, { data: { reason: " " } });
    expect(noReason.status()).toBe(400);
    expect(await noReason.json()).toMatchObject({ details: { fieldErrors: { reason: ["required"] } } });
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await accountant.post(`/api/v1/payments/${id}/void`, { data: { reason: "x" } })).status()).toBe(404);
      expect((await accountant.post(`/api/v1/cash-transactions/${id}/void`, { data: { reason: "x" } })).status()).toBe(404);
    }
  });
});
