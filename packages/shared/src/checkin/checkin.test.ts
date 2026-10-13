import { describe, expect, it } from "vitest";
import { hangingReason, isClockOff, isInWindow, isPairedInTime, pickCandidate } from "./checkin.domain.js";

const RULES = { waitMinutes: 15, windowMinutes: 60 };
const at = (time: string) => new Date(`2026-10-15T${time}:00Z`);
const booking = (id: string, start: string, end: string, otherScanAt: string | null = null) => ({
  id,
  start: at(start),
  end: at(end),
  otherScanAt: otherScanAt ? at(otherScanAt) : null,
});

describe("the pairing window (D-070)", () => {
  it("accepts a scan from 1 hour before the start to 1 hour after the end, edges included", () => {
    const session = booking("a", "10:00", "11:00");
    expect(isInWindow(at("09:00"), session, 60)).toBe(true);
    expect(isInWindow(at("08:59"), session, 60)).toBe(false);
    expect(isInWindow(at("12:00"), session, 60)).toBe(true);
    expect(isInWindow(at("12:01"), session, 60)).toBe(false);
  });

  it("pairs two scans exactly 15 minutes apart but not 16", () => {
    expect(isPairedInTime(at("10:00"), at("10:15"), 15)).toBe(true);
    expect(isPairedInTime(at("10:15"), at("10:00"), 15)).toBe(true);
    expect(isPairedInTime(at("10:00"), at("10:16"), 15)).toBe(false);
  });
});

describe("which session a scan serves (D-070)", () => {
  it("is none when no session fits the window", () => {
    expect(pickCandidate([booking("a", "14:00", "15:00")], at("10:00"), RULES)).toBeNull();
  });

  it("takes the nearest start when several fit", () => {
    const picked = pickCandidate(
      [booking("late", "11:00", "12:00"), booking("near", "10:30", "11:30"), booking("early", "09:00", "10:00")],
      at("10:20"),
      RULES,
    );
    expect(picked?.id).toBe("near");
  });

  it("prefers the session whose other side already scanned in time over a nearer one", () => {
    const picked = pickCandidate(
      [booking("near", "10:00", "11:00"), booking("waiting", "11:00", "12:00", "10:50")],
      at("11:00"),
      RULES,
    );
    expect(picked?.id).toBe("waiting");
    // Out of time (16 minutes): the other side no longer counts.
    const late = pickCandidate(
      [booking("near", "10:50", "11:50"), booking("waiting", "12:00", "13:00", "10:44")],
      at("11:00"),
      RULES,
    );
    expect(late?.id).toBe("near");
  });
});

describe("hanging sessions (D-070, D-071)", () => {
  const now = at("12:00");
  it("names the missing side once the waiting time has passed", () => {
    expect(hangingReason({ customerScanAt: at("11:30"), ptScanAt: null }, now, 15)).toBe("PT_MISSING");
    expect(hangingReason({ customerScanAt: null, ptScanAt: at("11:30") }, now, 15)).toBe("CUSTOMER_MISSING");
  });

  it("is not hanging while the side may still come, with both scans, or with none", () => {
    expect(hangingReason({ customerScanAt: at("11:45"), ptScanAt: null }, now, 15)).toBeNull();
    expect(hangingReason({ customerScanAt: at("11:30"), ptScanAt: at("11:31") }, now, 15)).toBeNull();
    expect(hangingReason({ customerScanAt: null, ptScanAt: null }, now, 15)).toBeNull();
  });
});

describe("clock warnings (D-072)", () => {
  it("warns beyond the tolerance either way and never for an unknown clock", () => {
    expect(isClockOff(121, 120)).toBe(true);
    expect(isClockOff(-121, 120)).toBe(true);
    expect(isClockOff(120, 120)).toBe(false);
    expect(isClockOff(null, 120)).toBe(false);
  });
});
