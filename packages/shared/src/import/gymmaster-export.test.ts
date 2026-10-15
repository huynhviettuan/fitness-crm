import { describe, expect, it } from "vitest";
import {
  approvedInSource,
  contractTypeOf,
  detectSheet,
  isNoDate,
  matchColumns,
  parseDay,
  parseShares,
} from "./index.js";

// GymMaster's own exports (received 2026-10-15, doc 32 §2; M9.2b, A-301 to A-305). The headers are those of the files; no person's
// data is copied here.

const MEMBERS = [
  "STT",
  "Mã HV",
  "Họ",
  "Tên đệm",
  "Họ tên hội viên",
  "Mã vân tay",
  "Ngày sinh",
  "SĐT",
  "Email",
  "Địa chỉ",
  "Ngày đăng ký",
  "Chi nhánh",
  "Trạng thái đăng ký",
  "Nhóm khách",
  "Giới tính",
  "Nguồn HV",
  "NV phụ trách",
];
const CONTRACTS = [
  "STT",
  "Mã HV",
  "Họ tên hội viên",
  "Ngày sinh",
  "SĐT",
  "Email",
  "Địa chỉ",
  "Giới tính",
  "Chi nhánh",
  "Mã HĐ",
  "Ngày HĐ",
  "Dịch vụ - gói thẻ",
  "Loại HĐ",
  "Kích hoạt",
  "Trạng thái",
  "Đơn giá",
  "Tổng tiền",
  "Chiết khấu phần trăm",
  "Chiết khấu tiền",
  "Tổng thanh toán",
  "Đã thanh toán",
  "Còn nợ",
  "Số tháng",
  "Số ngày",
  "Số buổi thẻ gạch",
  "Số buổi đã tập",
  "Số buổi còn lại",
  "Ngày bắt đầu tập",
  "Ngày hết hạn tập",
  "Nhân viên PT",
  "Nhân viên Sale",
  "Ghi chú",
  "Số buổi KM",
  "Duyệt HĐ?",
];
const PT_REPORT = [
  "STT",
  "Mã nhân viên",
  "Tên nhân viên",
  "Mã hội viên",
  "Tên hội viên",
  "Show dạy",
  "Mã HĐ",
  "Dịch vụ",
];
const CASH_BOOK = ["STT", "Mã phiếu", "Thời gian", "Diễn giải", "Số tiền", "Mã khách hàng", "Mã HĐ", "Tên dịch vụ"];
const BOOKINGS = [
  "STT",
  "Mã học viên",
  "Tên học viên",
  "SĐT",
  "Ngày",
  "Giờ vào",
  "Giờ ra",
  "Trạng thái",
  "HLV",
  "Mã HLV",
];

describe("which export a file is (A-301)", () => {
  it("knows the contracts and the members by their headers, whatever the tab is called", () => {
    expect(detectSheet(CONTRACTS)).toBe("contracts");
    expect(detectSheet(MEMBERS)).toBe("customers");
  });

  it("does not take the PT report, the cash book or the bookings for something to import", () => {
    expect(detectSheet(PT_REPORT)).toBeNull();
    expect(detectSheet(CASH_BOOK)).toBeNull();
    expect(detectSheet(BOOKINGS)).toBeNull();
  });
});

describe("the columns of the GymMaster exports (A-302)", () => {
  it("are all found in the contracts export", () => {
    const { index, missing } = matchColumns("contracts", CONTRACTS);
    expect(missing).toEqual([]);
    const at = (field: keyof typeof index) => CONTRACTS[index[field]!];
    expect(at("legacyCode")).toBe("Mã HĐ");
    expect(at("customerLegacyCode")).toBe("Mã HV");
    expect(at("packageName")).toBe("Dịch vụ - gói thẻ");
    expect(at("contractDate")).toBe("Ngày HĐ");
    expect(at("startDate")).toBe("Ngày bắt đầu tập");
    expect(at("endDate")).toBe("Ngày hết hạn tập");
    expect(at("sessions")).toBe("Số buổi thẻ gạch");
    expect(at("bonusSessions")).toBe("Số buổi KM");
    expect(at("sessionsUsed")).toBe("Số buổi đã tập");
    expect(at("sessionsLeft")).toBe("Số buổi còn lại");
    expect(at("paid")).toBe("Đã thanh toán");
    expect(at("debt")).toBe("Còn nợ");
    expect(at("contractType")).toBe("Loại HĐ");
    expect(at("approval")).toBe("Duyệt HĐ?");
    expect(at("trainers")).toBe("Nhân viên PT");
    expect(at("sellers")).toBe("Nhân viên Sale");
    expect(at("customerName")).toBe("Họ tên hội viên");
    expect(at("customerPhone")).toBe("SĐT");
  });

  it("take the value after discounts, though the amount before them comes first in the file", () => {
    const { index } = matchColumns("contracts", CONTRACTS);
    expect(CONTRACTS[index.value!]).toBe("Tổng thanh toán");
  });

  it("are all found in the members export", () => {
    const { index, missing } = matchColumns("customers", MEMBERS);
    expect(missing).toEqual([]);
    expect(MEMBERS[index.legacyCode!]).toBe("Mã HV");
    expect(MEMBERS[index.fullName!]).toBe("Họ tên hội viên");
    expect(MEMBERS[index.dateOfBirth!]).toBe("Ngày sinh");
  });
});

describe("GymMaster's ways of writing values", () => {
  it("read a day with its time, and know 30/11/-0001 for no date", () => {
    expect(parseDay("05/10/2026 00:00:00")?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(parseDay("2026-10-05T08:30")?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(isNoDate("30/11/-0001")).toBe(true);
    expect(isNoDate("00/00/0000")).toBe(true);
    expect(isNoDate("0000-00-00 00:00:00")).toBe(true);
    expect(isNoDate("30/11/2001")).toBe(false);
    expect(isNoDate(null)).toBe(false);
  });

  it("read the staff of a contract with their shares (A-303)", () => {
    expect(parseShares("Trần Văn A (100%)")).toEqual([{ name: "Trần Văn A", percent: 100 }]);
    expect(parseShares("Lê B (60%), Phạm C (40%)")).toEqual([
      { name: "Lê B", percent: 60 },
      { name: "Phạm C", percent: 40 },
    ]);
    expect(parseShares("Nguyễn D")).toEqual([{ name: "Nguyễn D", percent: 100 }]);
    expect(parseShares("Đỗ E (33,5%)")).toEqual([{ name: "Đỗ E", percent: 33.5 }]);
    expect(parseShares("")).toEqual([]);
    expect(parseShares(null)).toEqual([]);
  });

  it("read the contract type and whether GymMaster approved it (A-302, A-305)", () => {
    expect(contractTypeOf("Renew")).toBe("RENEW");
    expect(contractTypeOf("New")).toBe("NEW");
    expect(contractTypeOf("Gia hạn")).toBe("RENEW");
    expect(contractTypeOf("")).toBe("NEW");
    expect(approvedInSource("Đã duyệt")).toBe(true);
    expect(approvedInSource("Chưa duyệt")).toBe(false);
    expect(approvedInSource("")).toBe(true);
    expect(approvedInSource(null)).toBe(true);
  });
});
