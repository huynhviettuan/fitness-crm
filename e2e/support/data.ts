import { randomUUID } from "node:crypto";
import { otherOptionId } from "./options";
import type { APIRequestContext } from "@playwright/test";

// Test data created through the public API. Names carry the test's tag so the
// `testTag` fixture removes them afterwards.

export const PT24 = {
  packageName: "PT 24 buổi",
  contractValue: "12.000.000",
  totalSessions: "24",
  startDate: "01/10/2026",
  endDate: "31/12/2030",
};

export async function createCustomerViaApi(api: APIRequestContext, tag: string, phone = "0909400100") {
  const response = await api.post("/api/v1/customers", { data: { fullName: `Khách ${tag}`, phone } });
  if (response.status() !== 201) throw new Error(`Customer setup failed: ${response.status()}`);
  return response.json() as Promise<{ id: string; customerCode: string; fullName: string }>;
}

export async function createContractViaApi(
  api: APIRequestContext,
  customerId: string,
  options: { activate?: boolean; data?: Partial<typeof PT24> } = {},
) {
  const response = await api.post(`/api/v1/customers/${customerId}/contracts`, {
    headers: { "idempotency-key": randomUUID() },
    data: { ...PT24, ...options.data },
  });
  if (response.status() !== 201) throw new Error(`Contract setup failed: ${response.status()}`);
  const contract = (await response.json()) as { id: string; contractCode: string; status: string };
  if (options.activate) await api.post(`/api/v1/contracts/${contract.id}/activate`);
  return contract;
}

export async function createTrainerViaApi(api: APIRequestContext, tag: string, options: { userId?: string } = {}) {
  const response = await api.post("/api/v1/trainers", { data: { fullName: `PT ${tag}`, userId: options.userId ?? "" } });
  if (response.status() !== 201) throw new Error(`Trainer setup failed: ${response.status()}`);
  return response.json() as Promise<{ id: string; trainerCode: string; fullName: string }>;
}

export type BookingSlot = { date: string; startTime: string; endTime: string };

/**
 * A day inside PT24's dates for bookings with a test's own trainer. Far from today, so
 * the "today" view only shows bookings a test makes for today on purpose.
 */
export const BOOKING_DAY = { date: "20/06/2030", url: "2030-06-20" };

export async function createBookingViaApi(
  api: APIRequestContext,
  refs: { customerId: string; contractId: string; trainerId: string },
  slot: BookingSlot,
) {
  const response = await api.post("/api/v1/bookings", { data: { ...refs, ...slot } });
  if (response.status() !== 201) throw new Error(`Booking setup failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<{ id: string; status: string }>;
}

/**
 * A customer with an active contract and a trainer of their own, so bookings never
 * collide with another test's trainer. Everything carries the tag.
 */
export async function bookingSetup(
  apiAs: (role: "RECEPTIONIST" | "FITNESS_MANAGER") => Promise<APIRequestContext>,
  tag: string,
  contract: Partial<typeof PT24> = {},
) {
  const reception = await apiAs("RECEPTIONIST");
  const customer = await createCustomerViaApi(reception, tag);
  const created = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, { activate: true, data: contract });
  const trainer = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), tag);
  return { customer, contract: created, trainer, refs: { customerId: customer.id, contractId: created.id, trainerId: trainer.id } };
}

/**
 * A random day in 2027–2029, for tests that book the shared E2E trainer: parallel
 * tests then almost never pick the same day.
 */
export function randomBookingDay(): { date: string; url: string } {
  const day = new Date(Date.UTC(2027, 0, 1) + Math.floor(Math.random() * 1000) * 86_400_000);
  const [y, m, d] = day.toISOString().slice(0, 10).split("-");
  return { date: `${d}/${m}/${y}`, url: `${y}-${m}-${d}` };
}

/** Today in the gym timezone (A-001). */
export function gymToday(): { date: string; url: string } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).split("-");
  return { date: `${d}/${m}/${y}`, url: `${y}-${m}-${d}` };
}

/** A payment with "Khác" as its method and the note "E2E" (any list option would do). */
export async function recordPaymentViaApi(api: APIRequestContext, contractId: string, amount: string, paidOn = gymToday().date) {
  const response = await api.post(`/api/v1/contracts/${contractId}/payments`, {
    headers: { "idempotency-key": randomUUID() },
    data: { amount, methodId: await otherOptionId(api, "paymentMethods"), methodNote: "E2E", paidOn },
  });
  if (response.status() !== 201) throw new Error(`Payment setup failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<{ id: string; amount: number; status: string }>;
}
