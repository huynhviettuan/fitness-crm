"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { raiseExchange, raiseHold, raiseRenewal } from "@/lib/api/changes";
import type { ExchangeInput, HoldInput, RenewalInput } from "@flow/shared/changes";

// The writes of the change vouchers (M8): each answers whether the voucher waits for approval or already acts.

export async function raiseRenewalAction(
  input: RenewalInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => ({ pending: (await raiseRenewal(input, idempotencyKey)).status === "PENDING" }));
}

export async function raiseHoldAction(
  input: HoldInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => ({ pending: (await raiseHold(input, idempotencyKey)).status === "PENDING" }));
}

export async function raiseExchangeAction(
  kind: "upgrades" | "conversions",
  input: ExchangeInput,
  idempotencyKey: string,
): Promise<ActionResult<{ pending: boolean }>> {
  return runAction(async () => ({ pending: (await raiseExchange(kind, input, idempotencyKey)).status === "PENDING" }));
}
