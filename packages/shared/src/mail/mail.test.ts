import { describe, expect, it } from "vitest";
import { EVENT_KEY_PATTERN, MAX_EMAIL_ATTEMPTS, nextAttemptAt } from "./mail.domain.js";

describe("nextAttemptAt", () => {
  const now = new Date("2026-10-12T03:00:00.000Z");

  it("waits 1, 5, then 30 minutes after the first three failures", () => {
    expect(nextAttemptAt(1, now)?.toISOString()).toBe("2026-10-12T03:01:00.000Z");
    expect(nextAttemptAt(2, now)?.toISOString()).toBe("2026-10-12T03:05:00.000Z");
    expect(nextAttemptAt(3, now)?.toISOString()).toBe("2026-10-12T03:30:00.000Z");
  });

  it("gives up after the last attempt", () => {
    expect(MAX_EMAIL_ATTEMPTS).toBe(4);
    expect(nextAttemptAt(4, now)).toBeNull();
  });
});

describe("EVENT_KEY_PATTERN", () => {
  it("accepts dotted words and refuses anything else", () => {
    expect(EVENT_KEY_PATTERN.test("session.credited")).toBe(true);
    expect(EVENT_KEY_PATTERN.test("contract.activated")).toBe(true);
    expect(EVENT_KEY_PATTERN.test("Session")).toBe(false);
    expect(EVENT_KEY_PATTERN.test("a..b")).toBe(false);
    expect(EVENT_KEY_PATTERN.test("a b")).toBe(false);
  });
});
