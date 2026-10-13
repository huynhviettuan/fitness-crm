import "server-only";
import {
  bookingListSchema,
  bookingPageSchema,
  bookingSchema,
  sessionCompletionSchema,
  sessionStatusListSchema,
  sessionStatusSchema,
  type BookingInput,
  type BookingStatus,
  type RescheduleInput,
  type SessionStatusInput,
} from "@flow/shared/bookings";
import { api, query, read } from "./client";

export type BookingQuery = {
  /** First and last gym day, inclusive (dd/MM/yyyy). */
  from?: string;
  to?: string;
  status?: BookingStatus;
  /** Booked sessions the customer has checked in to. */
  checkedIn?: boolean;
  trainerId?: string;
  customerId?: string;
  contractId?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function listBookings(params: BookingQuery) {
  return read(bookingPageSchema, (await api()).GET("/api/v1/bookings", { params: { query: query(params) } }));
}

/** One gym day (dd/MM/yyyy) of the PT calendar. */
export async function listDayBookings(params: { date: string; trainerId?: string }) {
  const { items } = await read(
    bookingListSchema,
    (await api()).GET("/api/v1/schedule", { params: { query: query(params) } }),
  );
  return items;
}

export async function createBooking(input: BookingInput) {
  return read(bookingSchema, (await api()).POST("/api/v1/bookings", { body: input }));
}

export async function rescheduleBooking(id: string, input: RescheduleInput) {
  return read(bookingSchema, (await api()).PATCH("/api/v1/bookings/{id}", { params: { path: { id } }, body: input }));
}

export async function cancelBooking(id: string) {
  return read(bookingSchema, (await api()).POST("/api/v1/bookings/{id}/cancel", { params: { path: { id } } }));
}

export async function markNoShow(id: string) {
  return read(bookingSchema, (await api()).POST("/api/v1/bookings/{id}/no-show", { params: { path: { id } } }));
}

export async function checkIn(id: string) {
  return read(bookingSchema, (await api()).POST("/api/v1/bookings/{id}/check-in", { params: { path: { id } } }));
}

/** Returns the booking and the contract with its new remaining sessions. */
export async function completeSession(id: string) {
  return read(
    sessionCompletionSchema,
    (await api()).POST("/api/v1/bookings/{id}/complete", { params: { path: { id } } }),
  );
}

/** The session statuses and their rules (brief §6.2, D-025). */
export async function listSessionStatuses() {
  const { items } = await read(sessionStatusListSchema, (await api()).GET("/api/v1/session-statuses"));
  return items;
}

/** Admin changes a rule; it applies to the next status change only (T-050). */
export async function updateSessionStatus(code: string, input: SessionStatusInput) {
  return read(
    sessionStatusSchema,
    (await api()).PUT("/api/v1/session-statuses/{code}", { params: { path: { code } }, body: input }),
  );
}
