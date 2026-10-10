import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, instantAt, parseDateOnly } from "./dates.js";

const GYM_TZ = "Asia/Ho_Chi_Minh";

describe("parseDateOnly", () => {
  it("parses dd/MM/yyyy to UTC midnight", () => {
    expect(parseDateOnly("15/03/1990")?.toISOString()).toBe("1990-03-15T00:00:00.000Z");
    expect(parseDateOnly(" 01/01/2000 ")?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });

  it.each(["31/02/2026", "2026-03-15", "15/3/1990", "", "abc"])("rejects %j", (value) => {
    expect(parseDateOnly(value)).toBeNull();
  });
});

describe("calendarDateInTimeZone", () => {
  it("is the gym's day at UTC midnight, not the server's", () => {
    // 17:30 UTC on 9 Oct is 00:30 on 10 Oct in Ho Chi Minh City (UTC+7).
    expect(calendarDateInTimeZone(GYM_TZ, new Date("2026-10-09T17:30:00Z"))).toEqual(new Date("2026-10-10T00:00:00Z"));
  });
});

describe("instantAt", () => {
  it("turns a gym day and wall-clock time into the UTC instant", () => {
    const day = new Date("2026-10-15T00:00:00Z");
    expect(instantAt(day, "18:00", GYM_TZ)).toEqual(new Date("2026-10-15T11:00:00Z"));
    expect(instantAt(day, "00:30", GYM_TZ)).toEqual(new Date("2026-10-14T17:30:00Z"));
  });
});
