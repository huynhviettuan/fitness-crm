// The bundled build: Playwright's loader cannot load exceljs's streaming reader (unzipper and its
// dependencies), and reading a finished file needs none of it.
import ExcelJSBundle from "exceljs/dist/exceljs.bare.js";
import type ExcelJSTypes from "exceljs";
import { readFileSync } from "node:fs";
import type { Download } from "@playwright/test";

const ExcelJS = ExcelJSBundle as unknown as typeof ExcelJSTypes;

/** What an exported file holds: its header row and the rows under it, as text or numbers. */
export type Sheet = { name: string; header: string[]; rows: (string | number | Date | null)[][] };

function toSheet(workbook: ExcelJSTypes.Workbook): Sheet {
  const sheet = workbook.worksheets[0];
  const rows = (sheet.getSheetValues() as unknown[][]).slice(1).map((row) => row.slice(1));
  const [header = [], ...body] = rows as (string | number | Date | null)[][];
  return { name: sheet.name, header: header as string[], rows: body };
}

/** The file a browser downloaded. */
export async function readDownload(download: Download): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync((await download.path())!) as unknown as ArrayBuffer);
  return toSheet(workbook);
}

/** The file an API call returned. */
export async function readBody(body: Buffer): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return toSheet(workbook);
}
