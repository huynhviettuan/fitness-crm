import { describe, expect, it } from "vitest";
import {
  BOARD_STATUSES,
  canChangeLeadStatus,
  isRecareStatus,
  MANUAL_LEAD_STATUSES,
  nextLeadStatuses,
} from "./lead.domain.js";
import {
  formatLeadCode,
  LEAD_STATUSES,
  leadAssignSchema,
  leadBoardQuerySchema,
  leadInputSchema,
  leadStatusChangeSchema,
  listLeadsSchema,
} from "./lead.schema.js";

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
      countryCode: null,
      needGroupId: null,
      needGroupNote: null,
      needDetailId: null,
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
      leadInputSchema.parse({
        fullName: "A",
        channelId: CHANNEL,
        phone: "090 912.3456",
        email: " An@Mail.VN ",
        sourceType: "PAID",
        countryCode: "us",
      }),
    ).toMatchObject({ phone: "0909123456", email: "an@mail.vn", sourceType: "PAID", countryCode: "US" });
  });

  it("rejects a missing name and channel, a bad phone, and unknown classifications", () => {
    expect(
      fieldErrors(leadInputSchema.safeParse({ fullName: " ", phone: "12", sourceType: "FREE", countryCode: "MARS" })),
    ).toEqual({
      fullName: "required",
      channelId: "required",
      phone: "invalidPhone",
      sourceType: "invalidChoice",
      countryCode: "invalidChoice",
    });
  });

  it("never accepts a code, a stage, or a status from the client", () => {
    const parsed = leadInputSchema.parse({
      fullName: "A",
      channelId: CHANNEL,
      leadCode: "LD1",
      stage: "CUSTOMER",
      status: "CONTRACTED",
    });
    expect(parsed).not.toHaveProperty("leadCode");
    expect(parsed).not.toHaveProperty("stage");
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("listLeadsSchema", () => {
  it("treats empty filters as none", () => {
    expect(listLeadsSchema.parse({ status: "", channelId: "" })).toMatchObject({
      status: undefined,
      channelId: undefined,
      page: 1,
    });
    expect(listLeadsSchema.safeParse({ status: "WON" }).success).toBe(false);
  });
});

describe("lead journey (D-020, docs/02 flow 2)", () => {
  it("leaves New only through assignment, and Show and Contracted not at all", () => {
    expect(nextLeadStatuses("NEW")).toEqual([]);
    expect(nextLeadStatuses("SHOWED")).toEqual([]);
    expect(nextLeadStatuses("CONTRACTED")).toEqual([]);
  });

  it("follows the consulting flow", () => {
    expect(nextLeadStatuses("CONSULTING")).toEqual(["CONSIDERING", "NO_RESPONSE", "BOOKED", "REFUSED"]);
    expect(canChangeLeadStatus("CONSIDERING", "BOOKED")).toBe(true);
    expect(canChangeLeadStatus("CONSULTING", "SHOWED")).toBe(false);
    expect(canChangeLeadStatus("CONSULTING", "CONSULTING")).toBe(false);
  });

  it("never closes re-care cases: they return to Consulting or an appointment (brief §3)", () => {
    for (const status of ["NO_RESPONSE", "REFUSED", "NO_SHOW"] as const) {
      expect(isRecareStatus(status)).toBe(true);
      expect(canChangeLeadStatus(status, "CONSULTING")).toBe(true);
      expect(canChangeLeadStatus(status, "BOOKED")).toBe(true);
    }
    expect(isRecareStatus("CONSIDERING")).toBe(false);
  });

  it("moves an appointment by booking again; only Booked goes to itself", () => {
    expect(canChangeLeadStatus("BOOKED", "BOOKED")).toBe(true);
    for (const status of LEAD_STATUSES.filter((value) => value !== "BOOKED"))
      expect(canChangeLeadStatus(status, status)).toBe(false);
  });

  it("only ever moves to a status set by hand", () => {
    for (const from of LEAD_STATUSES)
      for (const to of nextLeadStatuses(from)) expect(MANUAL_LEAD_STATUSES).toContain(to);
    expect(BOARD_STATUSES).not.toContain("SHOWED");
    expect(BOARD_STATUSES).not.toContain("CONTRACTED");
  });
});

describe("leadStatusChangeSchema", () => {
  const REASON = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

  it("needs the appointment's day and time for Booked", () => {
    expect(fieldErrors(leadStatusChangeSchema.safeParse({ status: "BOOKED" }))).toEqual({
      appointmentDate: "required",
      appointmentTime: "required",
    });
    expect(
      fieldErrors(
        leadStatusChangeSchema.safeParse({ status: "BOOKED", appointmentDate: "31/02/2026", appointmentTime: "25:00" }),
      ),
    ).toEqual({
      appointmentDate: "invalidDate",
      appointmentTime: "invalidTime",
    });
    expect(
      leadStatusChangeSchema.parse({ status: "BOOKED", appointmentDate: "20/10/2026", appointmentTime: "9:30" }),
    ).toEqual({
      status: "BOOKED",
      appointment: { date: new Date(Date.UTC(2026, 9, 20)), time: "09:30" },
      refuseReason: null,
      note: null,
    });
  });

  it("needs a reason for Refused (BR-204)", () => {
    expect(fieldErrors(leadStatusChangeSchema.safeParse({ status: "REFUSED", refuseReasonId: "" }))).toEqual({
      refuseReasonId: "required",
    });
    expect(
      leadStatusChangeSchema.parse({
        status: "REFUSED",
        refuseReasonId: REASON,
        refuseReasonNote: " Xa nhà ",
        note: "Gọi lại sau Tết",
      }),
    ).toEqual({
      status: "REFUSED",
      appointment: null,
      refuseReason: { optionId: REASON, note: "Xa nhà" },
      note: "Gọi lại sau Tết",
    });
  });

  it("ignores appointment and reason fields for other statuses", () => {
    expect(
      leadStatusChangeSchema.parse({ status: "CONSIDERING", appointmentDate: "x", refuseReasonId: REASON }),
    ).toEqual({
      status: "CONSIDERING",
      appointment: null,
      refuseReason: null,
      note: null,
    });
  });

  it("is never set to New, Show, or Contracted by hand", () => {
    for (const status of ["NEW", "SHOWED", "NO_SHOW", "CONTRACTED"])
      expect(leadStatusChangeSchema.safeParse({ status }).success).toBe(false);
  });
});

describe("leadAssignSchema and leadBoardQuerySchema", () => {
  it("needs a user", () => {
    expect(fieldErrors(leadAssignSchema.safeParse({ userId: "" }))).toEqual({ userId: "required" });
  });

  it("takes the list's filters without paging or status", () => {
    expect(leadBoardQuerySchema.parse({ q: " an ", status: "NEW", page: "2" })).toEqual({ q: "an" });
  });
});
