import { z } from "zod";
import { instant, pageOf } from "../validation/index.js";
import { CUSTOMER_STATUSES } from "./customer.schema.js";

// Response shapes: wire format in, Date objects out (see validation/codecs.ts).

export const customerSchema = z
  .object({
    id: z.uuid(),
    customerCode: z.string(),
    fullName: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    /** A calendar date at UTC midnight. */
    dateOfBirth: instant.nullable(),
    status: z.enum(CUSTOMER_STATUSES),
    notes: z.string().nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .meta({ id: "Customer" });

export const customerPageSchema = pageOf(customerSchema).meta({ id: "CustomerPage" });

/** How other records refer to their customer. */
export const customerRefSchema = z
  .object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() })
  .meta({ id: "CustomerRef" });

export type Customer = z.output<typeof customerSchema>;
export type CustomerPage = z.output<typeof customerPageSchema>;
