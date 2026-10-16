import "server-only";
import {
  customerPageSchema,
  customerSchema,
  customerStaffListSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@gymcrm/shared/customers";
import { api, query, read } from "./client";

export type CustomerQuery = {
  q?: string;
  page?: number;
  pageSize?: number;
  branchId?: string;
  staffId?: string;
  /** Registration days, dd/MM/yyyy. */
  registeredFrom?: string;
  registeredTo?: string;
  birthdayMonth?: number;
  noEmail?: boolean;
};

export async function listCustomers({ q, ...params }: CustomerQuery) {
  const client = await api();
  return read(
    customerPageSchema,
    client.GET("/api/v1/customers", {
      params: { query: query({ search: q, ...params, noEmail: params.noEmail || undefined }) },
    }),
  );
}

/** Who can be in charge of a customer: the active users of the user's branches (A-071). */
export async function listCustomerStaff() {
  const { items } = await read(customerStaffListSchema, (await api()).GET("/api/v1/customers/staff"));
  return items;
}

export async function getCustomer(id: string) {
  return read(customerSchema, (await api()).GET("/api/v1/customers/{id}", { params: { path: { id } } }));
}

export async function createCustomer(input: CreateCustomerInput) {
  return read(customerSchema, (await api()).POST("/api/v1/customers", { body: input as never }));
}

/** `submitted`: a change of name, phone, or email waits for approval (D-018). */
export async function updateCustomer(id: string, input: UpdateCustomerInput) {
  const call = (await api()).PATCH("/api/v1/customers/{id}", { params: { path: { id } }, body: input as never });
  const { response } = await call;
  const customer = await read(customerSchema, call);
  return { customer, submitted: response.status === 202 };
}
