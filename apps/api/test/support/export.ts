import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import type { Response } from "express";
import type { CurrentUser } from "../../src/platform/auth/session.js";
import { exportList, type ExportDefinition } from "../../src/platform/export/export.service.js";

/** An Express response that keeps what is written to it, to open the file the export made. */
function recordingResponse() {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const response = Object.assign(stream, {
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  });
  stream.on("data", (chunk: Buffer) => {
    response.headersSent = true;
    chunks.push(chunk);
  });
  return { response: response as unknown as Response, headers, chunks, stream };
}

/** Runs an export and opens the workbook it wrote, with the headers it sent. */
export async function exportToWorkbook<T>(
  actor: CurrentUser,
  definition: ExportDefinition<T>,
  query: Record<string, string | undefined> = {},
) {
  const { response, headers, chunks, stream } = recordingResponse();
  const ended = new Promise<void>((resolve) => stream.on("end", resolve));
  await exportList(actor, response, definition, query);
  await ended;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const rows = (sheet.getSheetValues() as unknown[][]).slice(1).map((row) => row.slice(1));
  const [header = [], ...body] = rows as (string | number | Date | null | undefined)[][];
  return { workbook, sheet, headers, header: header as string[], rows: body };
}
