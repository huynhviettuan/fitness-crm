import { describe, expect, it } from "vitest";
import {
  AVAILABLE_INTAKE_KINDS,
  INTAKE_KEY_PATTERN,
  INTAKE_KINDS,
  intakeSourceInputSchema,
  websiteLeadSchema,
} from "./index.js";

const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";

describe("the website submission (A-262)", () => {
  it("needs the form's own id and a name; everything else is optional", () => {
    const parsed = websiteLeadSchema.parse({ externalId: "f1", name: "  An  " });
    expect(parsed).toEqual({ externalId: "f1", name: "An", phone: null, email: null, message: null, pageUrl: null });
    expect(websiteLeadSchema.safeParse({ name: "An" }).success).toBe(false);
    expect(websiteLeadSchema.safeParse({ externalId: "f1" }).success).toBe(false);
  });

  it("reads the phone however it is written, and refuses what is not one", () => {
    const phone = (value: string) => websiteLeadSchema.parse({ externalId: "f", name: "An", phone: value }).phone;
    expect(phone("0909 123 456")).toBe(phone("0909123456"));
    expect(phone("")).toBeNull();
    expect(websiteLeadSchema.safeParse({ externalId: "f", name: "An", phone: "abc" }).success).toBe(false);
  });

  it("keeps the line breaks of a message but not other control characters, and caps its length", () => {
    const message = (value: string) => websiteLeadSchema.safeParse({ externalId: "f", name: "An", message: value });
    expect(message("một\nhai\r\nba").success).toBe(true);
    expect(message("bell\u0007").success).toBe(false);
    expect(message("x".repeat(4000)).success).toBe(true);
    expect(message("x".repeat(4001)).success).toBe(false);
    expect(websiteLeadSchema.safeParse({ externalId: "f", name: "a\u0007b" }).success).toBe(false);
  });

  it("refuses a field that is not listed, so a sender cannot choose the channel or the branch", () => {
    expect(websiteLeadSchema.safeParse({ externalId: "f", name: "An", channelId: id }).success).toBe(false);
    expect(websiteLeadSchema.safeParse({ externalId: "f", name: "An", branchId: id }).success).toBe(false);
  });
});

describe("the sources (A-261)", () => {
  it("can be registered now for the website and the Meta channels; the others are known kinds still to build", () => {
    expect(AVAILABLE_INTAKE_KINDS).toEqual(["WEBSITE", "WHATSAPP", "MESSENGER", "INSTAGRAM", "EMAIL"]);
    expect(INTAKE_KINDS).toEqual(
      expect.arrayContaining(["WHATSAPP", "MESSENGER", "INSTAGRAM", "EMAIL", "ZALO", "TIKTOK"]),
    );
    const base = { name: "Website", channelId: id };
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WEBSITE" }).success).toBe(true);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "MESSENGER" }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WEBSITE", name: "" }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WEBSITE", channelId: "" }).success).toBe(false);
  });

  it("have keys that are recognisable and well formed", () => {
    expect(INTAKE_KEY_PATTERN.test(`fci_${"a".repeat(43)}`)).toBe(true);
    expect(INTAKE_KEY_PATTERN.test("fci_short")).toBe(false);
    expect(INTAKE_KEY_PATTERN.test(`fcd_${"a".repeat(43)}`)).toBe(false);
    expect(INTAKE_KEY_PATTERN.test(`fci_${"a".repeat(43)} OR 1=1`)).toBe(false);
  });
});
