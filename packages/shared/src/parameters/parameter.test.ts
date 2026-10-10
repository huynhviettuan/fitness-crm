import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatCode, minutesOfDay, PARAMETER_DEFAULTS, parametersInputSchema } from "./parameter.schema.js";

const errors = (input: unknown) => {
  const result = parametersInputSchema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
};

describe("system parameters (T-049)", () => {
  it("accepts the brief's initial values", () => {
    expect(parametersInputSchema.parse(PARAMETER_DEFAULTS)).toEqual(PARAMETER_DEFAULTS);
  });

  it("keeps calendar hours on the half hour, the end after the start", () => {
    expect(errors({ ...PARAMETER_DEFAULTS, calendarDayStart: "05:15" })).toEqual({ calendarDayStart: ["notOnHalfHour"] });
    expect(errors({ ...PARAMETER_DEFAULTS, calendarDayStart: "22:00", calendarDayEnd: "06:00" })).toEqual({
      calendarDayEnd: ["endTimeNotAfterStart"],
    });
    expect(parametersInputSchema.parse({ ...PARAMETER_DEFAULTS, calendarDayStart: "5:30" }).calendarDayStart).toBe("05:30");
  });

  it("takes code prefixes of one to five letters, in capitals", () => {
    expect(parametersInputSchema.parse({ ...PARAMETER_DEFAULTS, customerCodePrefix: " hv " }).customerCodePrefix).toBe("HV");
    expect(errors({ ...PARAMETER_DEFAULTS, contractCodePrefix: "HD-1", trainerCodePrefix: "" })).toEqual({
      contractCodePrefix: ["invalidCodePrefix"],
      trainerCodePrefix: ["invalidCodePrefix"],
    });
  });

  it("formats codes and times", () => {
    expect(formatCode("KH", 42, 6)).toBe("KH000042");
    expect(minutesOfDay("05:30")).toBe(330);
  });
});
