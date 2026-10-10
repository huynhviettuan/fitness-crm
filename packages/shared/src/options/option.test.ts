import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isOptionList, listOptionsQuerySchema, optionInputSchema, optionOrderSchema } from "./option.schema.js";

const errors = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
};

describe("option lists (D-016)", () => {
  it("knows only the lists the flows use", () => {
    expect(isOptionList("paymentMethods")).toBe(true);
    expect(isOptionList("toString")).toBe(false);
  });

  it("an option needs both labels and starts active", () => {
    expect(optionInputSchema.parse({ labelVi: " Ví MoMo ", labelEn: "MoMo wallet" })).toEqual({
      labelVi: "Ví MoMo",
      labelEn: "MoMo wallet",
      active: true,
    });
    expect(errors(optionInputSchema, { labelVi: " ", labelEn: "x".repeat(101) })).toEqual({
      labelVi: ["required"],
      labelEn: ["tooLong"],
    });
  });

  it("an order is a list of option ids", () => {
    expect(errors(optionOrderSchema, { optionIds: [] })).toEqual({ optionIds: ["required"] });
    expect(errors(optionOrderSchema, { optionIds: ["nope"] })).toEqual({ optionIds: ["invalidChoice"] });
  });

  it("lists active options unless asked for all", () => {
    expect(listOptionsQuerySchema.parse({})).toEqual({ includeInactive: false });
    expect(listOptionsQuerySchema.parse({ includeInactive: "true" })).toEqual({ includeInactive: true });
  });
});
