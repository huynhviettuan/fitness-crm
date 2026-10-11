import { describe, expect, it } from "vitest";
import { formatLeadCode, leadInputSchema, listLeadsSchema } from "./lead.schema.js";

const CHANNEL = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

const fieldErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

describe("formatLeadCode (D-038)", () => {
  it("pads to the prefix + 6 digits", () => {
    expect(formatLeadCode("LD", 42)).toBe("LD000042");
  });
});

describe("leadInputSchema (brief §4.1)", () => {
  it("needs only a name and a channel; everything else may come later", () => {
    expect(leadInputSchema.parse({ fullName: " Nguyễn Văn An ", channelId: CHANNEL })).toEqual({
      fullName: "Nguyễn Văn An",
      gender: null,
      birthDate: null,
      phone: null,
      email: null,
      channelId: CHANNEL,
      channelNote: null,
      sourceId: null,
      sourceNote: null,
      sourceType: null,
      sourceDetail: null,
      nationalityGroup: null,
      needGroupId: null,
      needGroupNote: null,
      needDetail: null,
      painStatusId: null,
      painStatusNote: null,
      assessmentTypeId: null,
      assessmentTypeNote: null,
      notes: null,
    });
  });

  it("normalizes the phone and email and takes the fixed classifications", () => {
    expect(
      leadInputSchema.parse({ fullName: "A", channelId: CHANNEL, phone: "090 912.3456", email: " An@Mail.VN ", sourceType: "PAID", nationalityGroup: "FOREIGN" }),
    ).toMatchObject({ phone: "0909123456", email: "an@mail.vn", sourceType: "PAID", nationalityGroup: "FOREIGN" });
  });

  it("rejects a missing name and channel, a bad phone, and unknown classifications", () => {
    expect(fieldErrors(leadInputSchema.safeParse({ fullName: " ", phone: "12", sourceType: "FREE", nationalityGroup: "MARS" }))).toEqual({
      fullName: "required",
      channelId: "required",
      phone: "invalidPhone",
      sourceType: "invalidChoice",
      nationalityGroup: "invalidChoice",
    });
  });

  it("never accepts a code, a stage, or a status from the client", () => {
    const parsed = leadInputSchema.parse({ fullName: "A", channelId: CHANNEL, leadCode: "LD1", stage: "CUSTOMER", status: "CONTRACTED" });
    expect(parsed).not.toHaveProperty("leadCode");
    expect(parsed).not.toHaveProperty("stage");
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("listLeadsSchema", () => {
  it("treats empty filters as none", () => {
    expect(listLeadsSchema.parse({ status: "", channelId: "" })).toMatchObject({ status: undefined, channelId: undefined, page: 1 });
    expect(listLeadsSchema.safeParse({ status: "WON" }).success).toBe(false);
  });
});
