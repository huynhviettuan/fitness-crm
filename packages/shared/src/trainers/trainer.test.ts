import { describe, expect, it } from "vitest";
import { formatTrainerCode, trainerInputSchema } from "./trainer.schema.js";

describe("formatTrainerCode (D-038)", () => {
  it("pads to the prefix + 3 digits and keeps growing past 999", () => {
    expect(formatTrainerCode("PT", BigInt(1))).toBe("PT001");
    expect(formatTrainerCode("HLV", 1000)).toBe("HLV1000");
  });
});

describe("trainerInputSchema", () => {
  it("defaults to ACTIVE with no login, and stores an empty login choice as null", () => {
    expect(trainerInputSchema.parse({ fullName: " Trần Minh " })).toEqual({ fullName: "Trần Minh", status: "ACTIVE", userId: null });
    expect(trainerInputSchema.parse({ fullName: "A", status: "INACTIVE", userId: "" })).toMatchObject({ userId: null });
  });

  it("never accepts a trainer code from the client", () => {
    expect(trainerInputSchema.parse({ fullName: "A", trainerCode: "PT999" })).not.toHaveProperty("trainerCode");
  });
});
