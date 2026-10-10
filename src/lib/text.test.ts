import { describe, expect, it } from "vitest";
import { normalizeForSearch, normalizePhone } from "@/lib/text";

describe("normalizeForSearch", () => {
  it.each([
    ["Nguyễn Văn An", "nguyen van an"],
    ["ĐẶNG THỊ HỒNG", "dang thi hong"],
    ["  Trần   Đức  ", "tran duc"],
    ["Phạm Ngọc Ánh", "pham ngoc anh"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });
});

describe("normalizePhone", () => {
  it("removes spaces, dots, dashes, and brackets", () => {
    expect(normalizePhone("0909 123.456")).toBe("0909123456");
    expect(normalizePhone("(+84) 909-123-456")).toBe("+84909123456");
  });
});
