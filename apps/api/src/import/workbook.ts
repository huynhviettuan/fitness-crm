import ExcelJS from "exceljs";
import {
  IMPORT_COLUMNS,
  IMPORT_SHEETS,
  isTotalsSheet,
  matchColumns,
  sheetOf,
  type ImportSheet,
} from "@flow/shared/import";

// Reading and writing the import workbook (brief §11, D-039; M9.2). A workbook has a tab for each of customers, contracts and
// staff; the first row of a tab is its headers, matched to fields by their known names (`IMPORT_COLUMNS`).

export type ParsedRow = { row: number; cells: Record<string, unknown> };
export type ParsedSheet = { rows: ParsedRow[]; missing: string[]; unknown: string[] };
export type ParsedWorkbook = Partial<Record<ImportSheet | "totals", ParsedSheet>> & { ignoredSheets: string[] };

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

export async function readWorkbook(source: string | Buffer): Promise<ParsedWorkbook> {
  const book = new ExcelJS.Workbook();
  if (typeof source === "string") await book.xlsx.readFile(source);
  else await book.xlsx.load(source as unknown as ArrayBuffer);

  const parsed: ParsedWorkbook = { ignoredSheets: [] };
  for (const sheet of book.worksheets) {
    const kind = sheetOf(sheet.name) ?? (isTotalsSheet(sheet.name) ? "totals" : null);
    if (!kind) {
      parsed.ignoredSheets.push(sheet.name);
      continue;
    }
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      headers.push(String(plain(headerRow.getCell(column).value) ?? "").trim());
    }
    const match = matchColumns(kind, headers);
    const rows: ParsedRow[] = [];
    for (let at = 2; at <= sheet.rowCount; at += 1) {
      const row = sheet.getRow(at);
      const cells: Record<string, unknown> = {};
      let any = false;
      for (const [field, position] of Object.entries(match.index)) {
        const value = plain(row.getCell((position as number) + 1).value);
        if (typeof value === "string" ? value.trim() !== "" : value !== null) any = true;
        cells[field] = typeof value === "string" ? value.trim() : value;
      }
      if (any) rows.push({ row: at, cells });
    }
    parsed[kind] = { rows, missing: match.missing as string[], unknown: match.unknown };
  }
  return parsed;
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
