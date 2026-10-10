import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatCustomerCode } from "./customer.code.js";
import { createCustomerSchema, updateCustomerSchema } from "./customer.schema.js";

describe("formatCustomerCode (A-003)", () => {
  it("pads to KH + 6 digits", () => {
    expect(formatCustomerCode(BigInt(1))).toBe("KH000001");
    expect(formatCustomerCode(123)).toBe("KH000123");
  });

  it("keeps growing past 999999 instead of wrapping", () => {
    expect(formatCustomerCode(BigInt(1_000_000))).toBe("KH1000000");
  });
});

describe("createCustomerSchema", () => {
  const fieldErrors = (input: unknown) => {
    const result = createCustomerSchema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("normalizes input and stores blank optional fields as null", () => {
    const parsed = createCustomerSchema.parse({
      fullName: "  Nguyễn Văn An ",
      phone: "0909 123 456",
      email: "",
      dateOfBirth: "15/03/1990",
      notes: "",
    });
    expect(parsed).toEqual({
      fullName: "Nguyễn Văn An",
      phone: "0909123456",
      email: null,
      dateOfBirth: new Date("1990-03-15T00:00:00Z"),
      notes: null,
    });
  });

  it("treats missing optional fields as empty", () => {
    expect(createCustomerSchema.parse({ fullName: "An", phone: "0909123456" })).toMatchObject({
      email: null,
      dateOfBirth: null,
      notes: null,
    });
  });

  it("returns i18n keys as messages", () => {
    expect(fieldErrors({ fullName: "", phone: "" })).toEqual({ fullName: ["required"], phone: ["required"] });
    expect(fieldErrors({ fullName: "An", phone: "12ab", email: "nope", dateOfBirth: "31/02/2000" })).toEqual({
      phone: ["invalidPhone"],
      email: ["invalidEmail"],
      dateOfBirth: ["invalidDate"],
    });
  });

  it("rejects a date of birth in the future", () => {
    expect(fieldErrors({ fullName: "An", phone: "0909123456", dateOfBirth: "01/01/2999" })).toEqual({
      dateOfBirth: ["invalidDate"],
    });
  });

  it("ignores a customerCode in the input (BR-001)", () => {
    const parsed = createCustomerSchema.parse({ fullName: "An", phone: "0909123456", customerCode: "KH999999" });
    expect(parsed).not.toHaveProperty("customerCode");
  });
});

describe("updateCustomerSchema", () => {
  it("allows partial updates and never accepts customerCode", () => {
    const parsed = updateCustomerSchema.parse({ status: "INACTIVE", customerCode: "KH000999" });
    expect(parsed).toEqual({ status: "INACTIVE" });
  });
});
