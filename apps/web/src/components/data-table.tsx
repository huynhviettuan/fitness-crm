"use client";

import type { ReactNode } from "react";
import { flexRender, tableFeatures, useTable, type ColumnDef, type RowData } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Pagination, search, and sorting run on the server (docs/23 §1), so the table only
// needs the core features.
export const dataTableFeatures = tableFeatures({});
export type DataTableColumn<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData>;

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[];
  data: TData[];
  /** Accessible name of the table, e.g. the page title. */
  label: string;
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode;
  getRowId: (row: TData) => string;
  footer?: ReactNode;
};

export function DataTable<TData extends RowData>({ columns, data, label, empty, getRowId, footer }: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (row) => getRowId(row),
  });

  if (data.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border">
        <Table aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {footer}
    </div>
  );
}
