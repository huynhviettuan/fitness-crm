import { describe, expect, it } from "vitest";
import { formatTrainerCode, trainerInputSchema } from "@/modules/trainers/trainer.schema";

describe("formatTrainerCode (A-003)", () => {
  it("pads to PT + 3 digits and keeps growing past 999", () => {
    expect(formatTrainerCode(BigInt(1))).toBe("PT001");
    expect(formatTrainerCode(1000)).toBe("PT1000");
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
