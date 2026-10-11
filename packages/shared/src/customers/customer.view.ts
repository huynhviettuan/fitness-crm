import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { CUSTOMER_STATUSES } from "./customer.schema.js";
import { ID_DOCUMENT_TYPES } from "../leads/show.schema.js";

// Response shapes: wire format in, Date objects out (see validation/codecs.ts).

export const customerSchema = z
  .object({
    id: z.uuid(),
    customerCode: z.string(),
    branch: branchRefSchema,
    fullName: z.string(),
    /** Null when the role has the phone hidden (D-017); see maskedFields. */
    phone: z.string().nullable(),
    email: z.string().nullable(),
    /** A calendar date at UTC midnight. */
    dateOfBirth: instant.nullable(),
    status: z.enum(CUSTOMER_STATUSES),
    /** Given at Show (D-019); the number and health note are null when hidden (D-042), see maskedFields. */
    idDocumentType: z.enum(ID_DOCUMENT_TYPES).nullable(),
    idDocumentNumber: z.string().nullable(),
    nationality: z.string().nullable(),
    healthNote: z.string().nullable(),
    /** When the customer agreed that the ID and health data are kept (D-042). */
    dataConsentAt: instant.nullable(),
    notes: z.string().nullable(),
    createdAt: instant,
    updatedAt: instant,
    /** Fields hidden from this user, so screens can say "hidden" rather than "not provided". */
    maskedFields: z.array(z.enum(["phone", "email", "idDocument", "health"])),
    /**
     * A change of name, phone, or email waiting for approval (D-018): the values it
     * would set (hidden ones left out), or null. The fields above are still in effect.
     */
    pendingIdentity: z
      .object({
        approvalId: z.uuid(),
        fullName: z.string().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
      })
      .nullable(),
  })
  .meta({ id: "Customer" });

export const customerPageSchema = pageOf(customerSchema).meta({ id: "CustomerPage" });

/** How other records refer to their customer. */
export const customerRefSchema = z
  .object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() })
  .meta({ id: "CustomerRef" });

export type Customer = z.output<typeof customerSchema>;
export type CustomerPage = z.output<typeof customerPageSchema>;
