import { basename } from "node:path";
import ExcelJS from "exceljs";
import {
  IMPORT_COLUMNS,
  IMPORT_SHEETS,
  detectSheet,
  isTotalsSheet,
  matchColumns,
  sheetOf,
  type ImportSheet,
} from "@flow/shared/import";

// Reading and writing the import workbook (brief §11, D-039; M9.2, M9.2b). The data comes either as our own workbook, a tab for
// each of customers, contracts and staff, or as GymMaster's exports, one file each with a tab called "Worksheet" (doc 32 §2). A tab
// is known by its name, else by its headers (A-301); its header row is the first of its first rows that has a record's columns
// (GymMaster's booking report has a title above them), matched to fields by their known names (`IMPORT_COLUMNS`).

/** One row of data, with the file it came from when there were several. */
export type ParsedRow = { row: number; cells: Record<string, unknown>; file?: string };
export type ParsedSheet = { rows: ParsedRow[]; missing: string[]; unknown: string[] };
/** What each tab of each file was taken for, for the report: a record, or nothing (left out). */
export type FileUse = {
  file: string;
  tab: string;
  usedAs: ImportSheet | "totals" | null;
  headerRow: number | null;
  rows: number;
};
export type ParsedWorkbook = Partial<Record<ImportSheet | "totals", ParsedSheet>> & {
  ignoredSheets: string[];
  files?: FileUse[];
};

/** How far down a tab the header row is looked for. */
const HEADER_SEARCH_ROWS = 10;

/** The value of a cell as plain data: text of a rich cell, the result of a formula, a date as a Date. */
function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !(value instanceof Date)) {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return value.result ?? null;
    if ("text" in value) return value.text;
    return null;
  }
  return value;
}

function headersOf(sheet: ExcelJS.Worksheet, at: number): string[] {
  const row = sheet.getRow(at);
  const headers: string[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    headers.push(String(plain(row.getCell(column).value) ?? "").trim());
  }
  return headers;
}

/** The record a tab holds and the row of its headers: by its name first, else by what its headers are (A-301). */
function recognize(sheet: ExcelJS.Worksheet): { kind: ImportSheet | "totals"; headerRow: number } | null {
  const named = sheetOf(sheet.name) ?? (isTotalsSheet(sheet.name) ? "totals" : null);
  const last = Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);
  if (named) {
    // A named tab keeps row 1 unless a later row is where all the columns are.
    for (let at = 1; at <= last; at += 1) {
      if (matchColumns(named, headersOf(sheet, at)).missing.length === 0) return { kind: named, headerRow: at };
    }
    return { kind: named, headerRow: 1 };
  }
  for (let at = 1; at <= last; at += 1) {
    const kind = detectSheet(headersOf(sheet, at));
    if (kind) return { kind, headerRow: at };
  }
  return null;
}

/** Each file is a path, its bytes, or its bytes with a name for the report. */
export type ImportSource = string | Buffer | { name: string; data: Buffer };

/** A file as the report names it: its name without the folder. */
const nameOf = (source: ImportSource, index: number) =>
  typeof source === "string" ? basename(source) : Buffer.isBuffer(source) ? `file ${index + 1}` : source.name;

/** Reads one workbook or several (GymMaster's separate exports), as one set of records. */
export async function readWorkbook(source: ImportSource | ImportSource[]): Promise<ParsedWorkbook> {
  const sources = Array.isArray(source) ? source : [source];
  const parsed: ParsedWorkbook = { ignoredSheets: [], files: [] };
  for (const [index, one] of sources.entries()) {
    await readInto(parsed, one, sources.length > 1 ? nameOf(one, index) : undefined);
  }
  return parsed;
}

async function readInto(parsed: ParsedWorkbook, source: ImportSource, file: string | undefined): Promise<void> {
  const book = new ExcelJS.Workbook();
  if (typeof source === "string") await book.xlsx.readFile(source);
  else await book.xlsx.load((Buffer.isBuffer(source) ? source : source.data) as unknown as ArrayBuffer);
  const fileName =
    file ?? (typeof source === "string" ? basename(source) : Buffer.isBuffer(source) ? "workbook" : source.name);

  for (const sheet of book.worksheets) {
    const found = recognize(sheet);
    if (!found) {
      parsed.ignoredSheets.push(file ? `${file}: ${sheet.name}` : sheet.name);
      parsed.files?.push({ file: fileName, tab: sheet.name, usedAs: null, headerRow: null, rows: sheet.rowCount });
      continue;
    }
    const { kind, headerRow } = found;
    const match = matchColumns(kind, headersOf(sheet, headerRow));
    const rows: ParsedRow[] = [];
    for (let at = headerRow + 1; at <= sheet.rowCount; at += 1) {
      const row = sheet.getRow(at);
      const cells: Record<string, unknown> = {};
      let any = false;
      for (const [field, position] of Object.entries(match.index)) {
        const value = plain(row.getCell((position as number) + 1).value);
        if (typeof value === "string" ? value.trim() !== "" : value !== null) any = true;
        cells[field] = typeof value === "string" ? value.trim() : value;
      }
      if (any) rows.push({ row: at, cells, ...(file ? { file } : {}) });
    }
    parsed.files?.push({ file: fileName, tab: sheet.name, usedAs: kind, headerRow, rows: rows.length });
    // Two files of one record (members in two exports) add up; a missing column in either is reported.
    const before = parsed[kind];
    parsed[kind] = before
      ? {
          rows: [...before.rows, ...rows],
          missing: [...new Set([...before.missing, ...(match.missing as string[])])],
          unknown: [...new Set([...before.unknown, ...match.unknown])],
        }
      : { rows, missing: match.missing as string[], unknown: match.unknown };
  }
}

/** The blank workbook to hand to whoever exports from GymMaster: one tab per kind of record, the first alias as the header. */
export async function writeTemplate(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const kind of [...IMPORT_SHEETS, "totals"] as const) {
    const sheet = book.addWorksheet(kind);
    const columns = Object.values(IMPORT_COLUMNS[kind]);
    sheet.addRow(columns.map((column) => column.aliases[0]));
    sheet.getRow(1).font = { bold: true };
    columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = Math.max(16, column.aliases[0]!.length + 4);
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
