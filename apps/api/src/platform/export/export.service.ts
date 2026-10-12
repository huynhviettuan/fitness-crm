import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Response } from "express";
import type { MaskableField, Permission } from "@flow/shared/permissions";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { prisma } from "../db/prisma.js";
import { env } from "../env.js";
import { recordAudit } from "../audit/audit.repository.js";
import type { CurrentUser } from "../auth/session.js";
import { AppError } from "../errors/app-error.js";
import { assertCan } from "../permissions/assert.js";
import { isMasked } from "../permissions/scope.js";
import { readParameter } from "../parameters/parameter.service.js";

// Export to Excel (brief §1, §2, D-017, A-077 to A-080): one owner for every list. A list
// declares its columns once; the rows come from the same service the screen calls, so the
// search, filters, branches, data scope, and masks are the screen's.

type Cell = string | number | boolean | Date | null | undefined;
type Language = { vi: string; en: string };

export type ExportColumn<T> = {
  header: Language;
  /** How the cell looks in Excel: text by default. */
  kind?: "text" | "date" | "datetime" | "money" | "number";
  /** The column is left out of the file for a user who cannot see this field (D-017). */
  maskedBy?: MaskableField;
  width?: number;
  value: (row: T, locale: "vi" | "en") => Cell;
};

export type ExportDefinition<T> = {
  /** The list's name: the file name, and what the audit records. */
  list: string;
  title: Language;
  /** Needed in addition to the permission to see the list (A-077). */
  permission: Permission;
  columns: ExportColumn<T>[];
  /** One page of the list exactly as the screen shows it; the query is the screen's. */
  fetch: (
    actor: CurrentUser,
    query: Record<string, string | undefined>,
    page: number,
    pageSize: number,
  ) => Promise<{ items: T[]; total: number }>;
};

const PAGE_SIZE = 100;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NUMBER_FORMATS = {
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  money: "#,##0",
  number: "0",
} as const;

/** A moment as the wall clock of the gym shows it, since Excel keeps no time zone (A-079). */
function gymWallClock(moment: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.GYM_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(moment);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")));
}

/** The search text may be a phone, so the audit only says it was used (A-080). */
function auditedFilters(query: Record<string, string | undefined>): Record<string, string | boolean> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([key, value]) => value !== undefined && value !== "" && key !== "page" && key !== "pageSize")
      .map(([key, value]) => [key, key === "q" || key === "search" ? true : (value as string)]),
  );
}

/**
 * Streams the list as a workbook. Refused before anything is sent when the actor lacks the
 * export permission or the list is longer than `exportRowLimit` (A-078).
 */
export async function exportList<T>(
  actor: CurrentUser,
  response: Response,
  definition: ExportDefinition<T>,
  query: Record<string, string | undefined>,
): Promise<void> {
  assertCan(actor, definition.permission);
  const limit = Number(await readParameter(prisma, "exportRowLimit"));
  // The first page also checks the actor may see the list and that the filters are valid.
  const first = await definition.fetch(actor, query, 1, PAGE_SIZE);
  if (first.total > limit) throw new AppError("EXPORT_TOO_LARGE", { exportLimit: { limit, total: first.total } });

  const columns = definition.columns.filter((column) => !column.maskedBy || !isMasked(actor, column.maskedBy));
  const text = (language: Language) => language[actor.locale];
  const day = calendarDateInTimeZone(env.GYM_TIMEZONE).toISOString().slice(0, 10).replaceAll("-", "");

  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "export",
      entityId: randomUUID(),
      action: "export.downloaded",
      after: { list: definition.list, filters: auditedFilters(query), rowCount: first.total },
    }),
  );

  try {
    await send(actor, response, definition, query, first, columns, text(definition.title), day);
  } catch (error) {
    // Once the file has begun there is no error response to send: cut the download short.
    if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
    else throw error;
  }
}

async function send<T>(
  actor: CurrentUser,
  response: Response,
  definition: ExportDefinition<T>,
  query: Record<string, string | undefined>,
  first: { items: T[]; total: number },
  columns: ExportColumn<T>[],
  title: string,
  day: string,
): Promise<void> {
  response.setHeader("Content-Type", XLSX);
  response.setHeader("Content-Disposition", `attachment; filename="${definition.list}-${day}.xlsx"`);
  response.setHeader("Cache-Control", "no-store");
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response, useStyles: true });
  const sheet = workbook.addWorksheet(title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ width: column.width ?? 18 }));
  const header = sheet.addRow(columns.map((column) => column.header[actor.locale]));
  header.font = { bold: true };
  header.commit();

  const write = (items: T[]) => {
    for (const item of items) {
      const row = sheet.addRow(
        columns.map((column) => {
          const value = column.value(item, actor.locale) ?? null;
          return value instanceof Date && column.kind === "datetime" ? gymWallClock(value) : value;
        }),
      );
      columns.forEach((column, index) => {
        if (column.kind && column.kind !== "text") row.getCell(index + 1).numFmt = NUMBER_FORMATS[column.kind];
      });
      row.commit();
    }
  };
  write(first.items);
  for (let page = 2; page <= Math.ceil(first.total / PAGE_SIZE); page++) {
    const next = await definition.fetch(actor, query, page, PAGE_SIZE);
    if (next.items.length === 0) break;
    write(next.items);
  }
  sheet.commit();
  await workbook.commit();
}
