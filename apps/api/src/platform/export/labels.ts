import type { ChosenOption } from "@gymcrm/shared/options";

// The words the exported files use for fixed values, in both languages (A-079). They follow
// the web app's status labels (messages/*.json "status").

export type Locale = "vi" | "en";
type Words = Record<string, { vi: string; en: string }>;

const word = (words: Words, key: string, locale: Locale): string => words[key]?.[locale] ?? key;

const STATUS = {
  customer: {
    ACTIVE: { vi: "Đang hoạt động", en: "Active" },
    INACTIVE: { vi: "Ngừng hoạt động", en: "Inactive" },
  },
  user: {
    ACTIVE: { vi: "Đang hoạt động", en: "Active" },
    DISABLED: { vi: "Đã vô hiệu hóa", en: "Disabled" },
  },
  contract: {
    DRAFT: { vi: "Chờ duyệt", en: "Pending approval" },
    ACTIVE: { vi: "Đang hiệu lực", en: "Active" },
    EXPIRED: { vi: "Hết hạn", en: "Expired" },
    CANCELLED: { vi: "Đã hủy", en: "Cancelled" },
    REJECTED: { vi: "Đã từ chối", en: "Rejected" },
  },
  approval: {
    PENDING: { vi: "Chờ duyệt", en: "Pending" },
    APPROVED: { vi: "Đã duyệt", en: "Approved" },
    REJECTED: { vi: "Từ chối", en: "Rejected" },
  },
  task: {
    NEW: { vi: "Mới", en: "New" },
    ACCEPTED: { vi: "Đã nhận", en: "Accepted" },
    IN_PROGRESS: { vi: "Đang làm", en: "In progress" },
    DONE: { vi: "Hoàn thành", en: "Done" },
    CANCELLED: { vi: "Đã hủy", en: "Cancelled" },
  },
  priority: {
    LOW: { vi: "Thấp", en: "Low" },
    NORMAL: { vi: "Bình thường", en: "Normal" },
    HIGH: { vi: "Cao", en: "High" },
  },
  lead: {
    NEW: { vi: "Mới", en: "New" },
    CONSULTING: { vi: "Đang tư vấn", en: "Consulting" },
    CONSIDERING: { vi: "Cân nhắc", en: "Considering" },
    NO_RESPONSE: { vi: "Chưa phản hồi", en: "No response" },
    BOOKED: { vi: "Đã đặt lịch", en: "Appointment booked" },
    SHOWED: { vi: "Show", en: "Show" },
    NO_SHOW: { vi: "No show", en: "No show" },
    REFUSED: { vi: "Từ chối", en: "Refused" },
    CONTRACTED: { vi: "Đã ký hợp đồng", en: "Contracted" },
  },
  cashType: {
    INCOME: { vi: "Thu", en: "Income" },
    EXPENSE: { vi: "Chi", en: "Expense" },
  },
  trashEntity: {
    payment: { vi: "Phiếu thu", en: "Receipt" },
    cash_transaction: { vi: "Thu chi", en: "Income or expense" },
    person: { vi: "Hồ sơ", en: "Person record" },
  },
} satisfies Record<string, Words>;

export const statusLabel = (kind: keyof typeof STATUS, key: string, locale: Locale): string =>
  word(STATUS[kind], key, locale);

export const yesNo = (value: boolean, locale: Locale): string =>
  value ? (locale === "vi" ? "Có" : "Yes") : locale === "vi" ? "Không" : "No";

/** A chosen option in the user's language, with the note written with "Khác". */
export function optionText(option: ChosenOption | null | undefined, locale: Locale): string {
  if (!option) return "";
  const label = locale === "vi" ? option.labelVi : option.labelEn;
  return option.note ? `${label}: ${option.note}` : label;
}
