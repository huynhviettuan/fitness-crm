import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deleteSchema, listTrashSchema } from "./trash.schema.js";
import { listAuditSchema } from "../audit/audit.schema.js";

const errors = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
};

describe("deleting to the trash (D-035)", () => {
  it("needs a reason from the list; the note is optional here and required with Khác by the API", () => {
    const reasonId = "6f1c2a8e-3b4d-4c5e-9f60-7a8b9c0d1e2f";
    expect(deleteSchema.parse({ reasonId, reasonNote: " Nhập trùng " })).toEqual({
      reasonId,
      reasonNote: "Nhập trùng",
    });
    expect(errors(deleteSchema, { reasonId: "" })).toEqual({ reasonId: ["required"] });
  });

  it("filters the trash by kind and day", () => {
    expect(listTrashSchema.parse({ entityType: "", from: "" })).toEqual({ page: 1, pageSize: 20 });
    expect(errors(listTrashSchema, { entityType: "customer" })).toEqual({ entityType: ["invalidChoice"] });
  });
});

describe("action history filters (FR-PLT-008)", () => {
  it("ignores empty filters and refuses unknown ones", () => {
    expect(listAuditSchema.parse({ entityType: "", entityId: "", actorUserId: "" })).toEqual({ page: 1, pageSize: 20 });
    expect(errors(listAuditSchema, { entityType: "invoice", entityId: "x" })).toEqual({
      entityType: ["invalidChoice"],
      entityId: ["invalidChoice"],
    });
  });
});
