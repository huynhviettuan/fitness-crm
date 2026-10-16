// OWASP A01 (access control, mass assignment), A06/A08 (duplicate submission), A10
// (input errors) for the payment and cash routes added in Phase 4. Route-level 401s
// are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createContractViaApi, createCustomerViaApi, gymToday, recordPaymentViaApi } from "../support/data";
import { createOptionViaApi, otherOptionId } from "../support/options";
import { approvePendingViaApi } from "../support/approvals";
import type { Role } from "../support/db";

// Payment methods and delete reasons come from option lists (D-016); "Khác" with a note fits any test.
const PAYMENT = { amount: "1.000.000", methodNote: "E2E", paidOn: gymToday().date };
const payment = async (api: APIRequestContext) => ({
  ...PAYMENT,
  methodId: await otherOptionId(api, "paymentMethods"),
});
const deleteReason = async (api: APIRequestContext) => ({
  reasonId: await otherOptionId(api, "deleteReasons"),
  reasonNote: "Kiểm tra",
});

async function activeContract(apiAs: (role: Role) => Promise<APIRequestContext>, tag: string) {
  const reception = await apiAs("RECEPTIONIST");
  return createContractViaApi(await apiAs("FITNESS_MANAGER"), (await createCustomerViaApi(reception, tag)).id, {
    activateWith: await apiAs("ADMIN"),
  });
}

test.describe("A01 finance roles (docs/09, A-021)", () => {
  // Receipts wait for approval in the initial matrix (D-018): 202.
  const recordExpectations: [Role, number][] = [
    ["ADMIN", 202],
    ["FITNESS_MANAGER", 202],
    ["RECEPTIONIST", 202],
    ["ACCOUNTANT", 202],
    ["PT", 403],
  ];
  for (const [role, status] of recordExpectations) {
    test(`${role} recording a payment gets ${status}`, async ({ apiAs, testTag }) => {
      const contract = await activeContract(apiAs, testTag);
      const api = await apiAs(role);
      const response = await api.post(`/api/v1/contracts/${contract.id}/payments`, {
        headers: { "idempotency-key": randomUUID() },
        data: await payment(await apiAs("ADMIN")),
      });
      expect(response.status()).toBe(status);
    });
  }

  // 09_RBAC.md: deleting vouchers is Admin's (and the custom Kế toán role's).
  const deleteExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    // E2E-009 (part 2): a trainer cannot delete payments.
    ["PT", 403],
    ["FITNESS_MANAGER", 403],
    // Allowed, and waits for an admin's approval (D-018).
    ["ACCOUNTANT", 202],
  ];
  for (const [role, status] of deleteExpectations) {
    test(`${role} deleting a payment gets ${status}`, async ({ apiAs, testTag }) => {
      const contract = await activeContract(apiAs, testTag);
      const recorded = await recordPaymentViaApi(await apiAs("RECEPTIONIST"), contract.id, "1.000.000");

      const response = await (
        await apiAs(role)
      ).delete(`/api/v1/payments/${recorded.id}`, { data: await deleteReason(await apiAs("ADMIN")) });
      expect(response.status()).toBe(status);
    });
  }

  const cashExpectations: [Role, number][] = [
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 202],
  ];
  for (const [role, status] of cashExpectations) {
    test(`${role} recording income gets ${status}`, async ({ apiAs, testTag }) => {
      const response = await (
        await apiAs(role)
      ).post("/api/v1/cash-transactions", {
        headers: { "idempotency-key": randomUUID() },
        data: {
          type: "INCOME",
          categoryId: await createOptionViaApi(await apiAs("ADMIN"), "incomeCategories", `Bán nước ${testTag} ${role}`),
          methodId: await otherOptionId(await apiAs("ADMIN"), "paymentMethods"),
          methodNote: "E2E",
          amount: "100.000",
          occurredOn: gymToday().date,
        },
      });
      expect(response.status()).toBe(status);
    });
  }

  test("a trainer cannot read a contract's payments or the cash book", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const trainer = await apiAs("PT");

    expect((await trainer.get(`/api/v1/contracts/${contract.id}/payments`)).status()).toBe(403);
    expect((await trainer.get("/api/v1/cash-transactions")).status()).toBe(403);
  });

  test("approval status, contract, and recorder cannot be set by the client (mass assignment)", async ({
    apiAs,
    testTag,
  }) => {
    const contract = await activeContract(apiAs, testTag);
    const other = await activeContract(apiAs, `${testTag}b`);
    const reception = await apiAs("RECEPTIONIST");

    const response = await reception.post(`/api/v1/contracts/${contract.id}/payments`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        ...(await payment(reception)),
        approvalStatus: "APPROVED",
        deletedAt: new Date().toISOString(),
        contractId: other.id,
        createdById: randomUUID(),
        deleteReasonId: randomUUID(),
      },
    });

    expect(response.status()).toBe(202);
    expect(await response.json()).toMatchObject({ contract: { id: contract.id }, approvalStatus: "PENDING" });
    expect((await (await reception.get(`/api/v1/contracts/${contract.id}`)).json()).paidAmount).toBe(0);
    expect((await (await reception.get(`/api/v1/contracts/${other.id}`)).json()).paidAmount).toBe(0);
  });
});

test.describe("A06/A08 duplicate submission (T-015)", () => {
  test("a replay returns the original, and only one payment counts (INT-004)", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const data = await payment(reception);
    const send = (key: string, amount = PAYMENT.amount) =>
      reception.post(`/api/v1/contracts/${contract.id}/payments`, {
        headers: { "idempotency-key": key },
        data: { ...data, amount },
      });
    const key = randomUUID();

    const first = await send(key);
    const second = await send(key);

    expect([first.status(), second.status()]).toEqual([202, 200]);
    const id = (await first.json()).id;
    expect((await second.json()).id).toBe(id);

    // INT-005: the same key with another amount.
    const reused = await send(key, "2.000.000");
    expect(reused.status()).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    await approvePendingViaApi(await apiAs("FITNESS_MANAGER"), id);
    expect((await (await reception.get(`/api/v1/contracts/${contract.id}`)).json()).paidAmount).toBe(1_000_000);
  });

  test("five copies sent at once record one payment", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const key = randomUUID();
    const data = await payment(reception);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        reception.post(`/api/v1/contracts/${contract.id}/payments`, { headers: { "idempotency-key": key }, data }),
      ),
    );

    expect(responses.map((r) => r.status()).sort()).toEqual([200, 200, 200, 200, 202]);
    await approvePendingViaApi(await apiAs("FITNESS_MANAGER"), (await responses[0].json()).id);
    expect((await (await reception.get(`/api/v1/contracts/${contract.id}`)).json()).paidAmount).toBe(1_000_000);
  });

  test("a payment without an Idempotency-Key is refused", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);

    const reception = await apiAs("RECEPTIONIST");
    const response = await reception.post(`/api/v1/contracts/${contract.id}/payments`, {
      data: await payment(reception),
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });
});

test.describe("A10 finance input errors", () => {
  test("invalid amounts, methods, and dates are field errors; Khác needs a note (AC-04)", async ({
    apiAs,
    testTag,
  }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const [d, m, y] = gymToday().date.split("/").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
    const tomorrowText = `${String(tomorrow.getUTCDate()).padStart(2, "0")}/${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}/${tomorrow.getUTCFullYear()}`;
    const send = (data: object) =>
      reception.post(`/api/v1/contracts/${contract.id}/payments`, {
        headers: { "idempotency-key": randomUUID() },
        data,
      });
    const valid = await payment(reception);

    const invalid = await send({ amount: "12.5", methodId: "GOLD", paidOn: "2026-10-10" });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({
      details: { fieldErrors: { amount: ["invalidAmount"], methodId: ["required"], paidOn: ["invalidDate"] } },
    });
    expect(await (await send({ ...valid, amount: "0" })).json()).toMatchObject({
      details: { fieldErrors: { amount: ["amountNotPositive"] } },
    });
    expect(await (await send({ ...valid, paidOn: tomorrowText })).json()).toMatchObject({
      details: { fieldErrors: { paidOn: ["futureDate"] } },
    });
    expect(await (await send({ ...valid, methodNote: " " })).json()).toMatchObject({
      details: { fieldErrors: { methodNote: ["otherNeedsNote"] } },
    });
    // An option of another list, or none at all, is not a method.
    const reason = (await deleteReason(reception)).reasonId;
    for (const methodId of [reason, randomUUID()]) {
      expect(await (await send({ ...valid, methodId })).json()).toMatchObject({
        details: { fieldErrors: { methodId: ["invalidChoice"] } },
      });
    }
  });

  test("business rules answer with their documented codes", async ({ apiAs, testTag }) => {
    const contract = await activeContract(apiAs, testTag);
    const reception = await apiAs("RECEPTIONIST");
    const data = await payment(reception);
    const send = (contractId: string, amount: string) =>
      reception.post(`/api/v1/contracts/${contractId}/payments`, {
        headers: { "idempotency-key": randomUUID() },
        data: { ...data, amount },
      });

    const over = await send(contract.id, "12.000.001");
    expect(over.status()).toBe(422);
    expect(await over.json()).toMatchObject({ code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" });

    await (await apiAs("FITNESS_MANAGER")).post(`/api/v1/contracts/${contract.id}/cancel`);
    const cancelled = await send(contract.id, "1.000.000");
    expect(cancelled.status()).toBe(409);
    expect(await cancelled.json()).toMatchObject({ code: "PAYMENT_CONTRACT_CANCELLED" });
  });

  test("a deletion needs a reason and waits for approval once; a deleted or unknown record is 404", async ({
    apiAs,
    testTag,
  }) => {
    const contract = await activeContract(apiAs, testTag);
    const recorded = await recordPaymentViaApi(await apiAs("RECEPTIONIST"), contract.id, "1.000.000");
    const accountant = await apiAs("ACCOUNTANT");
    const reason = await deleteReason(accountant);

    const noReason = await accountant.delete(`/api/v1/payments/${recorded.id}`, { data: { reasonId: " " } });
    expect(noReason.status()).toBe(400);
    expect(await noReason.json()).toMatchObject({ details: { fieldErrors: { reasonId: ["required"] } } });
    const noNote = await accountant.delete(`/api/v1/payments/${recorded.id}`, { data: { ...reason, reasonNote: "" } });
    expect(await noNote.json()).toMatchObject({ details: { fieldErrors: { reasonNote: ["otherNeedsNote"] } } });
    const submitted = await accountant.delete(`/api/v1/payments/${recorded.id}`, { data: reason });
    expect(submitted.status()).toBe(202);
    expect(await submitted.json()).toMatchObject({ approval: { status: "PENDING" } });
    const again = await accountant.delete(`/api/v1/payments/${recorded.id}`, { data: reason });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: "APPROVAL_ALREADY_PENDING" });
    await approvePendingViaApi(await apiAs("ADMIN"), recorded.id, "record.delete");
    expect((await accountant.delete(`/api/v1/payments/${recorded.id}`, { data: reason })).status()).toBe(404);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await accountant.delete(`/api/v1/payments/${id}`, { data: reason })).status()).toBe(404);
      expect((await accountant.delete(`/api/v1/cash-transactions/${id}`, { data: reason })).status()).toBe(404);
    }
  });
});
