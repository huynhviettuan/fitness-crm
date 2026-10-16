import { createCustomerSchema } from "@gymcrm/shared/customers";
import { employeeInputSchema } from "@gymcrm/shared/employees";
import {
  approvedInSource,
  cleanupReasons,
  contractTypeOf,
  isNoDate,
  parseDay,
  parseShares,
  parseWhole,
  type CleanupReason,
  type ImportSheet,
} from "@gymcrm/shared/import";
import { displayNameOf } from "@gymcrm/shared/services";
import { normalizePhone } from "@gymcrm/shared/validation";
import type { Db } from "../platform/db/prisma.js";
import type { CurrentUser } from "../platform/auth/actor.js";
import { priceAt } from "../modules/services/service.service.js";
import type { ParsedRow, ParsedWorkbook } from "./workbook.js";

// The import plan (brief §11, D-039; M9.2): every row of the workbook checked against the rules of the system and the data
// already in it, without writing anything. A dry run prints it; a commit carries it out.

export type Action = "CREATE" | "ALREADY_IMPORTED" | "DUPLICATE" | "REJECT";

export type Entry = {
  sheet: ImportSheet;
  row: number;
  /** The file of the row, when the data came as several files (GymMaster's exports). */
  file?: string;
  legacyCode: string;
  action: Action;
  /** Why a row is rejected or a duplicate: codes the report explains. */
  issues: string[];
  /** What the row is, for the report: a name, a package. */
  label: string;
};

export type PlannedCustomer = {
  entry: Entry;
  input: { fullName: string; phone: string; email: string; dateOfBirth: string };
};
export type PlannedStaff = {
  entry: Entry;
  input: { fullName: string; phone: string; email: string; isTrainer: boolean };
};
export type PlannedContract = {
  entry: Entry;
  customerLegacyCode: string;
  packageName: string;
  /** The name the contract has afterwards: the service and the real session count (D-039). */
  newName: string;
  serviceId: string | null;
  tierId: string | null;
  tierUnitPrice: number | null;
  contractDate: Date;
  startDate: Date;
  endDate: Date;
  sessions: number;
  bonusSessions: number;
  sessionsUsed: number;
  value: number;
  paid: number;
  contractType: "NEW" | "RENEW";
  /** The PT and Sale staff with their shares, by name as GymMaster writes them (A-303). */
  shares: { role: "PT" | "SALE"; name: string; percent: number }[];
  cleanup: CleanupReason[];
};

export type Plan = {
  customers: PlannedCustomer[];
  staff: PlannedStaff[];
  contracts: PlannedContract[];
  /** Problems with the workbook as a whole: a tab without its required columns. */
  sheetIssues: { sheet: ImportSheet; code: string; fields: string[] }[];
  ignoredSheets: string[];
  unknownColumns: { sheet: ImportSheet; headers: string[] }[];
  /** What each file was taken for, when the data came as files (M9.2b). */
  files: NonNullable<ParsedWorkbook["files"]>;
};

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());
const dmy = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** A person's name as staff are matched by it: no accents, case or double spaces (A-303). */
export const staffNameKey = norm;

type Context = { db: Db; actor: CurrentUser; branchId: string; today: Date };

function entry(sheet: ImportSheet, source: ParsedRow, legacyCode: string, label: string): Entry {
  return {
    sheet,
    row: source.row,
    ...(source.file ? { file: source.file } : {}),
    legacyCode,
    action: "CREATE",
    issues: [],
    label,
  };
}

function rejected(item: Entry, ...issues: string[]): void {
  item.action = "REJECT";
  item.issues.push(...issues);
}

async function planCustomers(context: Context, rows: ParsedRow[]): Promise<PlannedCustomer[]> {
  const planned: PlannedCustomer[] = [];
  const codes = new Set<string>();
  const phones = new Map<string, string>();
  for (const source of rows) {
    const legacyCode = text(source.cells.legacyCode);
    const item = entry("customers", source, legacyCode, text(source.cells.fullName));
    // GymMaster writes "no birth date" as 30/11/-0001 (A-302).
    const dob = isNoDate(source.cells.dateOfBirth) ? null : source.cells.dateOfBirth;
    const birth = dob === null || dob === undefined || dob === "" ? null : parseDay(dob);
    const input = {
      fullName: text(source.cells.fullName),
      phone: text(source.cells.phone),
      email: text(source.cells.email),
      dateOfBirth: birth ? dmy(birth) : "",
    };
    if (legacyCode === "") rejected(item, "legacyCode:required");
    if (dob !== null && dob !== undefined && dob !== "" && !birth) rejected(item, "dateOfBirth:invalidDate");
    const parsed = createCustomerSchema.safeParse({ ...input, branchId: context.branchId });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) rejected(item, `${issue.path.join(".")}:${issue.message}`);
    }
    if (item.action === "CREATE" && legacyCode !== "") {
      if (codes.has(legacyCode)) rejected(item, "legacyCode:duplicateInFile");
      codes.add(legacyCode);
      const phone = parsed.success ? parsed.data.phone : "";
      const sameInFile = phones.get(phone);
      if (sameInFile) {
        item.action = "DUPLICATE";
        item.issues.push(`phone:sameAs:${sameInFile}`);
      } else {
        phones.set(phone, legacyCode);
        const known = await context.db.customer.findFirst({
          where: { OR: [{ legacyCode }, { phone }] },
          select: { legacyCode: true, customerCode: true },
        });
        if (known?.legacyCode === legacyCode) item.action = "ALREADY_IMPORTED";
        else if (known) {
          item.action = "DUPLICATE";
          item.issues.push(`phone:sameAs:${known.customerCode ?? ""}`);
        }
      }
    }
    planned.push({ entry: item, input });
  }
  return planned;
}

async function planStaff(context: Context, rows: ParsedRow[]): Promise<PlannedStaff[]> {
  const planned: PlannedStaff[] = [];
  const codes = new Set<string>();
  for (const source of rows) {
    const legacyCode = text(source.cells.legacyCode);
    const item = entry("staff", source, legacyCode, text(source.cells.fullName));
    const trainer = norm(text(source.cells.isTrainer));
    const input = {
      fullName: text(source.cells.fullName),
      phone: text(source.cells.phone),
      email: text(source.cells.email),
      isTrainer: ["1", "x", "true", "yes", "co", "pt", "y"].includes(trainer),
    };
    if (legacyCode === "") rejected(item, "legacyCode:required");
    const parsed = employeeInputSchema.safeParse({ ...input, branchId: context.branchId });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) rejected(item, `${issue.path.join(".")}:${issue.message}`);
    }
    if (item.action === "CREATE" && legacyCode !== "") {
      if (codes.has(legacyCode)) rejected(item, "legacyCode:duplicateInFile");
      codes.add(legacyCode);
      if (await context.db.employee.findFirst({ where: { legacyCode }, select: { id: true } })) {
        item.action = "ALREADY_IMPORTED";
      }
    }
    planned.push({ entry: item, input });
  }
  return planned;
}

async function planContracts(
  context: Context,
  rows: ParsedRow[],
  customerCodes: Set<string>,
  staffNames: Set<string>,
): Promise<PlannedContract[]> {
  const services = await context.db.service.findMany({
    where: { active: true, branches: { some: { branchId: context.branchId } } },
    select: { id: true, name: true },
  });
  // The staff a contract can name: those already in the system and those this run makes (A-303).
  const known = await context.db.employee.findMany({ select: { fullName: true } });
  const names = new Set([...staffNames, ...known.map((employee) => staffNameKey(employee.fullName))]);
  const planned: PlannedContract[] = [];
  const codes = new Set<string>();
  for (const source of rows) {
    const c = source.cells;
    const legacyCode = text(c.legacyCode);
    const packageName = text(c.packageName);
    const item = entry("contracts", source, legacyCode, packageName);
    const customerLegacyCode = text(c.customerLegacyCode);
    const startDate = parseDay(c.startDate);
    const endDate = parseDay(c.endDate);
    const contractDate = c.contractDate === null || c.contractDate === undefined ? startDate : parseDay(c.contractDate);
    const sessions = parseWhole(c.sessions);
    const blank = (cell: unknown) => cell === null || cell === undefined || cell === "";
    const bonusSessions = blank(c.bonusSessions) ? 0 : parseWhole(c.bonusSessions);
    const sessionsLeft = blank(c.sessionsLeft) ? null : parseWhole(c.sessionsLeft);
    // An empty "used" is none used, unless the file has the sessions left, which then say how many were (A-302).
    const entitled = (sessions ?? 0) + (bonusSessions ?? 0);
    const sessionsUsed = !blank(c.sessionsUsed)
      ? parseWhole(c.sessionsUsed)
      : sessionsLeft !== null && sessions !== null
        ? Math.max(0, entitled - sessionsLeft)
        : 0;
    const value = parseWhole(c.value);
    const paid = parseWhole(c.paid);
    const debt = blank(c.debt) ? null : parseWhole(c.debt);

    if (legacyCode === "") rejected(item, "legacyCode:required");
    if (packageName === "") rejected(item, "packageName:required");
    if (!startDate) rejected(item, "startDate:invalidDate");
    if (!endDate) rejected(item, "endDate:invalidDate");
    if (!contractDate) rejected(item, "contractDate:invalidDate");
    if (sessions === null || sessions < 1) rejected(item, "sessions:invalidNumber");
    if (bonusSessions === null || bonusSessions < 0) rejected(item, "bonusSessions:invalidNumber");
    if (sessionsUsed === null || sessionsUsed < 0) rejected(item, "sessionsUsed:invalidNumber");
    if (value === null || value < 0) rejected(item, "value:invalidNumber");
    if (paid === null || paid < 0) rejected(item, "paid:invalidNumber");
    if (startDate && endDate && endDate < startDate) rejected(item, "endDate:endBeforeStart");
    if (sessions !== null && sessionsUsed !== null && sessionsUsed > entitled)
      rejected(item, "sessionsUsed:aboveSessions");
    if (value !== null && paid !== null && paid > value) rejected(item, "paid:aboveValue");

    if (customerLegacyCode === "") rejected(item, "customerLegacyCode:required");
    else if (!customerCodes.has(customerLegacyCode)) {
      const known = await context.db.customer.findFirst({
        where: { legacyCode: customerLegacyCode },
        select: { id: true },
      });
      if (!known) rejected(item, "customerLegacyCode:unknownCustomer");
    }
    if (legacyCode !== "") {
      if (codes.has(legacyCode)) rejected(item, "legacyCode:duplicateInFile");
      codes.add(legacyCode);
    }
    if (
      item.action === "CREATE" &&
      (await context.db.contract.findFirst({ where: { legacyCode }, select: { id: true } }))
    ) {
      item.action = "ALREADY_IMPORTED";
    }

    // The service: named in the row, else the one whose name starts the package name (D-039).
    const wanted = norm(text(c.serviceName));
    const service =
      (wanted !== "" ? services.find((candidate) => norm(candidate.name) === wanted) : undefined) ??
      services.find((candidate) => norm(packageName).startsWith(norm(candidate.name)));
    let tierId: string | null = null;
    let tierUnitPrice: number | null = null;
    if (service && sessions !== null && sessions >= 1 && contractDate) {
      try {
        const { tier } = await priceAt(context.db, context.actor, service.id, sessions, contractDate);
        tierId = tier.id;
        tierUnitPrice = tier.unitPrice;
      } catch {
        // No version or no tier covers it: listed for the owner, not an error.
      }
    }
    const real = sessions ?? 0;
    const shares = [
      ...parseShares(c.trainers).map((share) => ({ role: "PT" as const, ...share })),
      ...parseShares(c.sellers).map((share) => ({ role: "SALE" as const, ...share })),
    ];
    // What GymMaster says that the figures do not, for the owner to confirm (A-302 to A-305).
    const more: CleanupReason[] = [];
    if (sessionsLeft !== null && sessionsUsed !== null && entitled - sessionsUsed !== sessionsLeft) {
      more.push("SESSIONS_LEFT_DIFFER");
    }
    if (debt !== null && value !== null && paid !== null && value - paid !== debt) more.push("DEBT_DIFFERS");
    if (!approvedInSource(c.approval)) more.push("NOT_APPROVED_IN_SOURCE");
    if (shares.some((share) => !names.has(staffNameKey(share.name)))) more.push("STAFF_NOT_FOUND");
    planned.push({
      entry: item,
      customerLegacyCode,
      packageName,
      newName: service && real > 0 ? displayNameOf(service.name, real) : packageName,
      serviceId: service?.id ?? null,
      tierId,
      tierUnitPrice,
      contractDate: contractDate ?? new Date(0),
      startDate: startDate ?? new Date(0),
      endDate: endDate ?? new Date(0),
      sessions: real,
      bonusSessions: bonusSessions ?? 0,
      sessionsUsed: sessionsUsed ?? 0,
      value: value ?? 0,
      paid: paid ?? 0,
      contractType: contractTypeOf(c.contractType),
      shares,
      cleanup:
        item.action === "REJECT"
          ? []
          : [
              ...cleanupReasons({
                packageName,
                sessions: real,
                value: value ?? 0,
                tierUnitPrice,
                hasService: service !== undefined,
              }),
              ...more,
            ],
    });
  }
  return planned;
}

/** Checks every row of the workbook; writes nothing. */
export async function buildPlan(context: Context, workbook: ParsedWorkbook): Promise<Plan> {
  const sheetIssues: Plan["sheetIssues"] = [];
  const unknownColumns: Plan["unknownColumns"] = [];
  for (const sheet of ["customers", "contracts", "staff"] as const) {
    const parsed = workbook[sheet];
    if (!parsed) continue;
    if (parsed.missing.length > 0) sheetIssues.push({ sheet, code: "missingColumns", fields: parsed.missing });
    if (parsed.unknown.length > 0) unknownColumns.push({ sheet, headers: parsed.unknown });
  }
  const broken = (sheet: ImportSheet) => sheetIssues.some((issue) => issue.sheet === sheet);
  const customers = await planCustomers(context, [
    ...(workbook.customers && !broken("customers") ? workbook.customers.rows : []),
    ...membersOnlyInContracts(workbook),
  ]);
  const staff = workbook.staff && !broken("staff") ? await planStaff(context, workbook.staff.rows) : [];
  // A contract may name a customer that is in the same file, or one imported earlier.
  const customerCodes = new Set(
    customers.filter((item) => item.entry.action !== "REJECT").map((item) => item.entry.legacyCode),
  );
  const staffNames = new Set(
    staff.filter((item) => item.entry.action === "CREATE").map((item) => staffNameKey(item.input.fullName)),
  );
  const contracts =
    workbook.contracts && !broken("contracts")
      ? await planContracts(context, workbook.contracts.rows, customerCodes, staffNames)
      : [];
  return {
    customers,
    staff,
    contracts,
    sheetIssues,
    ignoredSheets: workbook.ignoredSheets,
    unknownColumns,
    files: workbook.files ?? [],
  };
}

/**
 * The members a contracts export names that the members' file does not have: made from the contract's code, name and phone, once
 * each, so a contract is never left without its member (A-304). Members already in the system are found as usual.
 */
function membersOnlyInContracts(workbook: ParsedWorkbook): ParsedRow[] {
  const listed = new Set((workbook.customers?.rows ?? []).map((row) => text(row.cells.legacyCode)));
  const added: ParsedRow[] = [];
  for (const row of workbook.contracts?.rows ?? []) {
    const code = text(row.cells.customerLegacyCode);
    if (code === "" || listed.has(code) || text(row.cells.customerName) === "") continue;
    listed.add(code);
    added.push({
      row: row.row,
      ...(row.file ? { file: row.file } : {}),
      cells: { legacyCode: code, fullName: row.cells.customerName, phone: row.cells.customerPhone ?? "" },
    });
  }
  return added;
}

/** The counts of a plan by sheet and action, for the summary. */
export function summarize(plan: Plan): Record<ImportSheet, Record<Action, number>> {
  const empty = (): Record<Action, number> => ({ CREATE: 0, ALREADY_IMPORTED: 0, DUPLICATE: 0, REJECT: 0 });
  const result = { customers: empty(), contracts: empty(), staff: empty() };
  for (const item of [...plan.customers, ...plan.contracts, ...plan.staff])
    result[item.entry.sheet][item.entry.action] += 1;
  return result;
}

/** Unused for contracts: the phone is normalized the way the customer form does. */
export const phoneKey = normalizePhone;
