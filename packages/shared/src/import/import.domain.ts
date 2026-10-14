// The GymMaster import (brief §11, D-039, FR-IMP-001; M9.2): pure rules. The columns of the GymMaster exports are not known
// yet (OQ-053, OQ-069), so each field is matched by a list of header names; fitting a real file means adding names here.

export const IMPORT_SHEETS = ["customers", "contracts", "staff"] as const;
export type ImportSheet = (typeof IMPORT_SHEETS)[number];

/** A header without accents, case or punctuation: "Mã khách hàng" and "ma_khach_hang" are the same header. */
export function normalizeHeader(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type ColumnSpec = { required: boolean; aliases: readonly string[] };

/** What a sheet has: its field names, the header names each is known by, and whether the row is useless without it. */
export const IMPORT_COLUMNS = {
  customers: {
    legacyCode: { required: true, aliases: ["Mã khách hàng", "Mã hội viên", "Customer code", "Member ID", "Mã"] },
    fullName: { required: true, aliases: ["Họ tên", "Họ và tên", "Tên", "Full name", "Name"] },
    phone: { required: true, aliases: ["Số điện thoại", "SĐT", "Điện thoại", "Phone", "Mobile"] },
    email: { required: false, aliases: ["Email", "E-mail"] },
    dateOfBirth: { required: false, aliases: ["Ngày sinh", "Date of birth", "Birthday", "DOB"] },
  },
  contracts: {
    legacyCode: { required: true, aliases: ["Mã hợp đồng", "Contract code", "Contract ID", "Mã"] },
    customerLegacyCode: { required: true, aliases: ["Mã khách hàng", "Mã hội viên", "Customer code", "Member ID"] },
    packageName: { required: true, aliases: ["Tên gói", "Gói tập", "Package", "Package name"] },
    serviceName: { required: false, aliases: ["Dịch vụ", "Service"] },
    contractDate: { required: false, aliases: ["Ngày ký", "Ngày tạo", "Contract date", "Signed date"] },
    startDate: { required: true, aliases: ["Ngày bắt đầu", "Start date", "Start"] },
    endDate: { required: true, aliases: ["Ngày hết hạn", "Ngày kết thúc", "End date", "Expiry"] },
    sessions: { required: true, aliases: ["Số buổi", "Tổng số buổi", "Sessions", "Total sessions"] },
    sessionsUsed: { required: true, aliases: ["Số buổi đã dùng", "Đã tập", "Sessions used", "Used"] },
    value: { required: true, aliases: ["Giá trị hợp đồng", "Tổng tiền", "Contract value", "Total", "Amount"] },
    paid: { required: true, aliases: ["Đã thanh toán", "Đã trả", "Paid", "Paid amount"] },
  },
  // The totals GymMaster itself shows, one row under the headers, for the reconciliation (AC-22, M9.3).
  totals: {
    customers: { required: false, aliases: ["Số khách hàng", "Khách hàng", "Customers"] },
    contracts: { required: false, aliases: ["Số hợp đồng", "Hợp đồng", "Contracts"] },
    value: { required: false, aliases: ["Tổng giá trị hợp đồng", "Tổng giá trị", "Contract value", "Total value"] },
    paid: { required: false, aliases: ["Tổng đã thanh toán", "Đã thanh toán", "Paid", "Total paid"] },
    sessionsLeft: { required: false, aliases: ["Tổng số buổi còn lại", "Số buổi còn lại", "Sessions left"] },
  },
  staff: {
    legacyCode: { required: true, aliases: ["Mã nhân viên", "Staff code", "Employee code", "Mã"] },
    fullName: { required: true, aliases: ["Họ tên", "Họ và tên", "Tên", "Full name", "Name"] },
    phone: { required: false, aliases: ["Số điện thoại", "SĐT", "Phone", "Mobile"] },
    email: { required: false, aliases: ["Email", "E-mail"] },
    isTrainer: { required: false, aliases: ["PT", "Là PT", "Huấn luyện viên", "Trainer"] },
  },
} as const satisfies Record<ImportSheet | "totals", Record<string, ColumnSpec>>;

/** Alternative names of the sheets themselves. */
export const IMPORT_SHEET_ALIASES: Record<ImportSheet, readonly string[]> = {
  customers: ["Customers", "Khách hàng", "Hội viên", "Members"],
  contracts: ["Contracts", "Hợp đồng", "Packages", "Gói tập"],
  staff: ["Staff", "Nhân viên", "Employees", "PT"],
};

/** The tab of the control totals, by its names (M9.3). */
export const TOTALS_SHEET_ALIASES = ["Totals", "Tổng hợp", "Đối soát", "Control"] as const;

/** Whether a tab is the one of control totals. */
export function isTotalsSheet(name: string): boolean {
  const wanted = normalizeHeader(name);
  return TOTALS_SHEET_ALIASES.some((alias) => normalizeHeader(alias) === wanted);
}

/** The sheet a workbook's tab is, by its name; null when it is none of them. */
export function sheetOf(name: string): ImportSheet | null {
  const wanted = normalizeHeader(name);
  for (const sheet of IMPORT_SHEETS) {
    if (IMPORT_SHEET_ALIASES[sheet].some((alias) => normalizeHeader(alias) === wanted)) return sheet;
  }
  return null;
}

export type ColumnMatch<S extends ImportSheet | "totals"> = {
  /** Field name to the position of its column in the header row. */
  index: Partial<Record<keyof (typeof IMPORT_COLUMNS)[S], number>>;
  /** Required fields no header matched. */
  missing: (keyof (typeof IMPORT_COLUMNS)[S])[];
  /** Headers no field claimed: reported, not an error. */
  unknown: string[];
};

/** Matches a header row to the fields of a sheet. The first column that matches a field wins. */
export function matchColumns<S extends ImportSheet | "totals">(sheet: S, headers: readonly string[]): ColumnMatch<S> {
  const spec = IMPORT_COLUMNS[sheet] as Record<string, ColumnSpec>;
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  const claimed = new Set<number>();
  for (const [field, column] of Object.entries(spec)) {
    const names = column.aliases.map(normalizeHeader);
    const position = normalized.findIndex((header, at) => !claimed.has(at) && header !== "" && names.includes(header));
    if (position >= 0) {
      index[field] = position;
      claimed.add(position);
    }
  }
  const missing = Object.entries(spec)
    .filter(([field, column]) => column.required && index[field] === undefined)
    .map(([field]) => field);
  const unknown = headers.filter((header, at) => header.trim() !== "" && !claimed.has(at));
  return { index, missing, unknown } as unknown as ColumnMatch<S>;
}

/** The first whole number in a package name: "PT 24 buổi" is 24; null when there is none. */
export function packageSessions(packageName: string): number | null {
  const found = /\d+/.exec(packageName);
  return found ? Number(found[0]) : null;
}

/** Why a contract is on the owner's cleanup list (D-039). */
export const CLEANUP_REASONS = [
  "SESSIONS_DIFFER_FROM_NAME",
  "PRICE_DIFFERS_FROM_TIER",
  "NO_SERVICE",
  "NO_TIER",
] as const;
export type CleanupReason = (typeof CLEANUP_REASONS)[number];

/**
 * The reasons a brought-over contract needs the owner's word (D-039): its sessions are not the number in the package name
 * (24 recorded as 30), its price per session is not the tier's, or it could not be matched to a service or tier.
 */
export function cleanupReasons(input: {
  packageName: string;
  sessions: number;
  value: number;
  /** The unit price of the tier covering the sessions on the contract date; null when there is no service or no tier. */
  tierUnitPrice: number | null;
  hasService: boolean;
}): CleanupReason[] {
  const reasons: CleanupReason[] = [];
  const named = packageSessions(input.packageName);
  if (named !== null && named !== input.sessions) reasons.push("SESSIONS_DIFFER_FROM_NAME");
  if (!input.hasService) reasons.push("NO_SERVICE");
  else if (input.tierUnitPrice === null) reasons.push("NO_TIER");
  else if (input.sessions > 0 && Math.round(input.value / input.sessions) !== input.tierUnitPrice) {
    reasons.push("PRICE_DIFFERS_FROM_TIER");
  }
  return reasons;
}

export type RowIssue = { row: number; code: string; field?: string };

/** A day from a cell: a Date, or text as dd/MM/yyyy or yyyy-MM-dd; null when it is neither. */
export function parseDay(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const [year, month, day] = dmy ? [dmy[3], dmy[2], dmy[1]] : ymd ? [ymd[1], ymd[2], ymd[3]] : [];
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? date
    : null;
}

/** A whole number of dong or sessions from a cell: 12000000, "12.000.000", "12,000,000 ₫"; null when it is not one. */
export function parseWhole(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isInteger(value) ? value : Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s.,₫đ]|vnd/gi, "");
  return /^-?\d+$/.test(digits) ? Number(digits) : null;
}
