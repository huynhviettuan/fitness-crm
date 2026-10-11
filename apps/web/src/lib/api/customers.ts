import "server-only";
import {
  customerPageSchema,
  customerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@flow/shared/customers";
import { api, query, read } from "./client";

export async function listCustomers(params: { q?: string; page?: number; pageSize?: number }) {
  const client = await api();
  return read(
    customerPageSchema,
    client.GET("/api/v1/customers", {
      params: { query: query({ search: params.q, page: params.page, pageSize: params.pageSize }) },
    }),
  );
}

export async function getCustomer(id: string) {
  return read(customerSchema, (await api()).GET("/api/v1/customers/{id}", { params: { path: { id } } }));
}

export async function createCustomer(input: CreateCustomerInput) {
  return read(customerSchema, (await api()).POST("/api/v1/customers", { body: input }));
}

/** `submitted`: a change of name, phone, or email waits for approval (D-018). */
export async function updateCustomer(id: string, input: UpdateCustomerInput) {
  const call = (await api()).PATCH("/api/v1/customers/{id}", { params: { path: { id } }, body: input });
  const { response } = await call;
  const customer = await read(customerSchema, call);
  return { customer, submitted: response.status === 202 };
}
