import { describe, expect, it } from "vitest";
import { z } from "zod";
import { approvalRuleInputSchema, listApprovalsSchema, rejectSchema } from "./approval.schema.js";

const errors = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
};

describe("approval matrix rows (D-018)", () => {
  it("a rule that needs approval names at least one approver role", () => {
    expect(errors(approvalRuleInputSchema, { required: true, approverRoleIds: [], overdueHours: 24 })).toEqual({
      approverRoleIds: ["approverRequired"],
    });
    expect(approvalRuleInputSchema.parse({ required: false, approverRoleIds: [], overdueHours: "48" })).toEqual({
      required: false,
      approverRoleIds: [],
      overdueHours: 48,
    });
    expect(errors(approvalRuleInputSchema, { required: false, approverRoleIds: [], overdueHours: 0 })).toEqual({ overdueHours: ["outOfRange"] });
  });

  it("rejecting needs a reason; the inbox shows what the user may decide by default", () => {
    expect(errors(rejectSchema, { reasonId: "" })).toEqual({ reasonId: ["required"] });
    expect(listApprovalsSchema.parse({ status: "" })).toEqual({ view: "toDecide", page: 1, pageSize: 20 });
  });
});
