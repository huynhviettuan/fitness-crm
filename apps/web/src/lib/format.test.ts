import { describe, expect, it } from "vitest";
import { formatDate, formatDateOnly, formatDateTime, formatMoney, formatTime } from "@/lib/format";

const GYM_TZ = "Asia/Ho_Chi_Minh";

describe("formatMoney", () => {
  it("formats VND without decimals using the UI language's separators", () => {
    expect(formatMoney(12_000_000, "vi").replace(/\s/g, " ")).toBe("12.000.000 ₫");
    expect(formatMoney(12_000_000, "en")).toBe("₫12,000,000");
  });

  it("accepts decimal values such as Prisma.Decimal", () => {
    expect(formatMoney({ toString: () => "4000000" }, "en")).toBe("₫4,000,000");
  });
});

describe("dates in the gym timezone", () => {
  // 17:30 UTC on 9 Oct is 00:30 on 10 Oct in Ho Chi Minh City (UTC+7).
  const lateEveningUtc = new Date("2026-10-09T17:30:00Z");

  it("shows the gym's calendar day, not the server's", () => {
    expect(formatDate(lateEveningUtc, GYM_TZ)).toBe("10/10/2026");
    expect(formatTime(lateEveningUtc, GYM_TZ)).toBe("00:30");
    expect(formatDateTime(lateEveningUtc, GYM_TZ)).toBe("10/10/2026 00:30");
  });

  it("uses dd/MM/yyyy and 24-hour time", () => {
    expect(formatDateTime(new Date("2026-03-05T11:05:00Z"), GYM_TZ)).toBe("05/03/2026 18:05");
  });
});

describe("calendar dates (date of birth)", () => {
  it("never shifts a stored SQL date by a day", () => {
    expect(formatDateOnly(new Date("1990-03-15T00:00:00Z"))).toBe("15/03/1990");
  });
});
