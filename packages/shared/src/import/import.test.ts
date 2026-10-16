import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  cleanupReasons,
  isTotalsSheet,
  matchColumns,
  normalizeHeader,
  packageSessions,
  parseDay,
  parseWhole,
  sheetOf,
} from "./index.js";

describe("headers (D-039, OQ-069)", () => {
  it("are the same whatever the accents, case or punctuation", () => {
    expect(normalizeHeader("Mã khách hàng")).toBe("makhachhang");
    expect(normalizeHeader("ma_khach_hang")).toBe("makhachhang");
    expect(normalizeHeader("  Đã thanh toán ")).toBe("dathanhtoan");
  });

  it("find the sheets by their names in either language", () => {
    expect(sheetOf("Khách hàng")).toBe("customers");
    expect(sheetOf("contracts")).toBe("contracts");
    expect(sheetOf("NHÂN VIÊN")).toBe("staff");
    expect(sheetOf("Notes")).toBeNull();
  });

  it("are matched to fields by their known names, and say what is missing or unknown", () => {
    const match = matchColumns("customers", ["Mã hội viên", "Họ và tên", "SĐT", "Ghi chú"]);
    expect(match.index).toEqual({ legacyCode: 0, fullName: 1, phone: 2 });
    expect(match.missing).toEqual([]);
    expect(match.unknown).toEqual(["Ghi chú"]);
    expect(matchColumns("customers", ["Họ tên"]).missing).toEqual(["legacyCode", "phone"]);
  });

  it("give one column to one field only: the same header cannot be both codes", () => {
    const match = matchColumns("contracts", [
      "Mã hợp đồng",
      "Mã khách hàng",
      "Tên gói",
      "Ngày bắt đầu",
      "Ngày hết hạn",
      "Số buổi",
      "Số buổi đã dùng",
      "Giá trị hợp đồng",
      "Đã thanh toán",
    ]);
    expect(match.missing).toEqual([]);
    expect(match.index.legacyCode).toBe(0);
    expect(match.index.customerLegacyCode).toBe(1);
    expect(Object.keys(IMPORT_COLUMNS.contracts)).toContain("sessionsUsed");
  });
});

describe("the contract cleanup list (D-039)", () => {
  const base = { packageName: "PT 24 buổi", sessions: 24, value: 12_000_000, tierUnitPrice: 500_000, hasService: true };

  it("lets through a contract that agrees with its name and its tier", () => {
    expect(packageSessions("PT 24 buổi")).toBe(24);
    expect(packageSessions("Gói tháng")).toBeNull();
    expect(cleanupReasons(base)).toEqual([]);
  });

  it("lists 24 sessions recorded as 30, and a price that is not the tier's", () => {
    expect(cleanupReasons({ ...base, sessions: 30, value: 15_000_000 })).toEqual(["SESSIONS_DIFFER_FROM_NAME"]);
    expect(cleanupReasons({ ...base, value: 10_000_000 })).toEqual(["PRICE_DIFFERS_FROM_TIER"]);
  });

  it("lists a contract with no service, or no tier for its sessions", () => {
    expect(cleanupReasons({ ...base, hasService: false, tierUnitPrice: null })).toEqual(["NO_SERVICE"]);
    expect(cleanupReasons({ ...base, tierUnitPrice: null })).toEqual(["NO_TIER"]);
    expect(cleanupReasons({ ...base, packageName: "Gói tháng", sessions: 24 })).toEqual([]);
  });
});

describe("cells", () => {
  it("are read as days in either order of writing, and refused when they are not days", () => {
    expect(parseDay("05/10/2026")?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(parseDay("2026-10-05")?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(parseDay(new Date("2026-10-05T17:00:00Z"))?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("tomorrow")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it("are read as whole numbers however money is written", () => {
    expect(parseWhole(12_000_000)).toBe(12_000_000);
    expect(parseWhole("12.000.000")).toBe(12_000_000);
    expect(parseWhole("12,000,000 ₫")).toBe(12_000_000);
    expect(parseWhole("abc")).toBeNull();
    expect(parseWhole("")).toBeNull();
    expect(parseWhole(undefined)).toBeNull();
  });
});

describe("the control totals tab (M9.3)", () => {
  it("is found by its name and its headers", () => {
    expect(isTotalsSheet("Đối soát")).toBe(true);
    expect(isTotalsSheet("totals")).toBe(true);
    expect(isTotalsSheet("Customers")).toBe(false);
    const match = matchColumns("totals", [
      "Số khách hàng",
      "Số hợp đồng",
      "Tổng giá trị hợp đồng",
      "Tổng đã thanh toán",
      "Tổng số buổi còn lại",
    ]);
    expect(match.index).toEqual({ customers: 0, contracts: 1, value: 2, paid: 3, sessionsLeft: 4 });
    expect(match.missing).toEqual([]);
  });
});
