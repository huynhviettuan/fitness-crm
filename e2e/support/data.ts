import { randomUUID } from "node:crypto";
import { otherOptionId } from "./options";
import { approvePendingViaApi } from "./approvals";
import type { APIRequestContext } from "@playwright/test";
import { createUserViaApi, roleIdOf } from "./admin";

// Test data created through the public API. Names carry the test's tag so the
// `testTag` fixture removes them afterwards.

export const PT24 = {
  packageName: "PT 24 buổi",
  contractValue: "12.000.000",
  totalSessions: "24",
  startDate: "01/10/2026",
  endDate: "31/12/2030",
};

/**
 * A phone number nobody else has: one phone belongs to one person (D-019), and tests
 * run in parallel against one database.
 */
export function uniquePhone(): string {
  return `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

export async function createCustomerViaApi(api: APIRequestContext, tag: string, phone = uniquePhone()) {
  const response = await api.post("/api/v1/customers", { data: { fullName: `Khách ${tag}`, phone } });
  if (response.status() !== 201) throw new Error(`Customer setup failed: ${response.status()}`);
  return response.json() as Promise<{ id: string; customerCode: string; fullName: string }>;
}

export async function createContractViaApi(
  api: APIRequestContext,
  customerId: string,
  /** `activateWith`: who approves (activates) it; never its creator (D-018). */
  options: { activateWith?: APIRequestContext; data?: Partial<typeof PT24> } = {},
) {
  const response = await api.post(`/api/v1/customers/${customerId}/contracts`, {
    headers: { "idempotency-key": randomUUID() },
    data: { ...PT24, ...options.data },
  });
  if (response.status() !== 201) throw new Error(`Contract setup failed: ${response.status()}`);
  const contract = (await response.json()) as { id: string; contractCode: string; status: string };
  if (options.activateWith) {
    const activated = await options.activateWith.post(`/api/v1/contracts/${contract.id}/activate`);
    if (!activated.ok()) throw new Error(`Contract activation failed: ${activated.status()} ${await activated.text()}`);
  }
  return contract;
}

/** Every day around the clock, so a test's slots are inside working hours (D-030). */
export const ALL_DAY_SHIFTS = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "24:00" }));

/**
 * An employee who teaches PT, named `PT <tag>`, working the given shifts (default:
 * every day around the clock).
 */
export async function createTrainerViaApi(
  api: APIRequestContext,
  tag: string,
  options: { userId?: string; shifts?: { weekday: number; start: string; end: string }[] } = {},
) {
  const response = await api.post("/api/v1/employees", {
    data: { fullName: `PT ${tag}`, isTrainer: true, userId: options.userId ?? "" },
  });
  if (response.status() !== 201) throw new Error(`Trainer setup failed: ${response.status()} ${await response.text()}`);
  const trainer = (await response.json()) as { id: string; employeeCode: string; fullName: string };
  const shifts = await api.put(`/api/v1/employees/${trainer.id}/shifts`, {
    data: { shifts: options.shifts ?? ALL_DAY_SHIFTS },
  });
  if (!shifts.ok()) throw new Error(`Shift setup failed: ${shifts.status()} ${await shifts.text()}`);
  return trainer;
}

/** The ISO weekday (1 Monday … 7 Sunday) of a dd/MM/yyyy day. */
export function isoWeekdayOf(date: string): number {
  const [d, m, y] = date.split("/").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
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
  apiAs: (role: "RECEPTIONIST" | "FITNESS_MANAGER" | "ADMIN") => Promise<APIRequestContext>,
  tag: string,
  contract: Partial<typeof PT24> = {},
) {
  const reception = await apiAs("RECEPTIONIST");
  const customer = await createCustomerViaApi(reception, tag);
  const created = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
    activateWith: await apiAs("ADMIN"),
    data: contract,
  });
  const trainer = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), tag);
  return {
    customer,
    contract: created,
    trainer,
    refs: { customerId: customer.id, contractId: created.id, trainerId: trainer.id },
  };
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

/** The gym day `offset` days from today, dd/MM/yyyy. */
export function gymDay(offset: number): string {
  const [y, m, d] = gymToday().url.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + offset));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/**
 * A payment with "Khác" as its method and the note "E2E" (any list option would do).
 * It waits for approval (D-018) unless `approver` approves it at once.
 */
export async function recordPaymentViaApi(
  api: APIRequestContext,
  contractId: string,
  amount: string,
  options: { approver?: APIRequestContext; paidOn?: string } = {},
) {
  const response = await api.post(`/api/v1/contracts/${contractId}/payments`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      amount,
      methodId: await otherOptionId(api, "paymentMethods"),
      methodNote: "E2E",
      paidOn: options.paidOn ?? gymToday().date,
    },
  });
  if (![201, 202].includes(response.status()))
    throw new Error(`Payment setup failed: ${response.status()} ${await response.text()}`);
  const payment = (await response.json()) as { id: string; amount: number; approvalStatus: string };
  if (options.approver && payment.approvalStatus === "PENDING")
    await approvePendingViaApi(options.approver, payment.id);
  return payment;
}

/** A lead contact channel's id by its Vietnamese label. */
export async function leadChannelId(api: APIRequestContext, label: string): Promise<string> {
  const { items } = (await (await api.get("/api/v1/option-lists/leadChannels/options")).json()) as {
    items: { id: string; labelVi: string }[];
  };
  return items.find((option) => option.labelVi === label)!.id;
}

export type CreatedLead = {
  id: string;
  leadCode: string;
  fullName: string;
  status: string;
  pic: { id: string; name: string } | null;
};

export async function createLeadViaApi(
  api: APIRequestContext,
  data: { fullName: string; branchId?: string; phone?: string; countryCode?: string },
): Promise<CreatedLead> {
  const response = await api.post("/api/v1/leads", {
    data: { ...data, channelId: await leadChannelId(api, "WhatsApp") },
  });
  if (response.status() !== 201) throw new Error(`Lead setup failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<CreatedLead>;
}

/** A script for the library (A-072), named with the tag so teardown removes it. */
export async function createScriptViaApi(
  api: APIRequestContext,
  data: { situationVi: string; situationEn: string; answerVi?: string; answerEn?: string },
) {
  const response = await api.post("/api/v1/consulting-scripts", { data });
  if (response.status() !== 201) throw new Error(`Script setup failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<{ id: string; situationVi: string }>;
}

/** Shows a lead (D-019): it becomes a customer in the same record. */
export async function showLeadViaApi(api: APIRequestContext, lead: CreatedLead, phone: string, email: string) {
  const response = await api.post(`/api/v1/leads/${lead.id}/show`, {
    data: {
      idDocumentType: "CCCD",
      idDocumentNumber: `079${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      birthDate: "15/03/1990",
      countryCode: "VN",
      email,
      phone,
      consent: true,
    },
  });
  if (response.status() !== 200) throw new Error(`Show failed: ${response.status()} ${await response.text()}`);
  return lead.id;
}

/**
 * A branch of the test's own with two consultants, who receive its leads round-robin
 * (BR-203) without touching the shared branch's turn. Named with the tag, so teardown
 * removes them. Specs that use it are *.branch.spec.ts (playwright.config.ts).
 */
export async function branchWithConsultants(admin: APIRequestContext, tag: string) {
  const branch = await admin.post("/api/v1/branches", { data: { name: `CN ${tag}` } });
  if (branch.status() !== 201) throw new Error(`Branch setup failed: ${branch.status()}`);
  const branchId = ((await branch.json()) as { id: string }).id;
  const roleId = await roleIdOf(admin, { code: "CONSULTING" });
  const consultants = [];
  for (const label of ["Consultant A", "Consultant B"]) {
    consultants.push({
      ...(await createUserViaApi(admin, tag, { roleId, branchIds: [branchId], label })),
      name: `${label} ${tag}`,
    });
  }
  return { branchId, consultants };
}

/** The re-care statuses a lead can be put in for a test (BR-204). */
export type RecareStatus = "NO_RESPONSE" | "REFUSED" | "NO_SHOW";

/**
 * A lead in re-care, through the real status changes: Refused (with "Khác" and a note),
 * No response, or No show (booked, then missed). `consultant` works the lead; in the
 * shared branch the lead goes to the E2E consultant (BR-203).
 */
export async function leadInRecareViaApi(
  apis: { reception: APIRequestContext; consultant: APIRequestContext },
  data: { fullName: string; status: RecareStatus; phone?: string; branchId?: string },
): Promise<CreatedLead> {
  const { status, ...lead } = data;
  const created = await createLeadViaApi(apis.reception, lead);
  const change = async (body: unknown) => {
    const response = await apis.consultant.post(`/api/v1/leads/${created.id}/status`, { data: body });
    if (response.status() !== 200)
      throw new Error(`Status setup failed: ${response.status()} ${await response.text()}`);
  };
  if (status === "NO_SHOW") {
    await change({ status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:30" });
    const missed = await apis.consultant.post(`/api/v1/leads/${created.id}/no-show`);
    if (missed.status() !== 200) throw new Error(`No-show setup failed: ${missed.status()}`);
  } else if (status === "REFUSED") {
    await change({
      status,
      refuseReasonId: await otherOptionId(apis.consultant, "leadRefuseReasons"),
      refuseReasonNote: "E2E",
    });
  } else {
    await change({ status });
  }
  return created;
}
