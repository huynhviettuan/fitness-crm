"use client";

import { useTranslations } from "next-intl";
import { ClipboardListIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { HiddenValue } from "@/components/hidden-value";
import { SessionStatusBadge } from "@/components/status-badge";
import { TablePagination } from "@/components/table-pagination";
import type { SearchParams } from "@/lib/paging";
import type { BookingReportPage, BookingReportRow } from "@gymcrm/shared/reports";

/** The booking report (brief §9, A-171): customer, phone, check-in and check-out, status, PT, and created date. */
export function BookingReportView({ result, params }: { result: BookingReportPage; params: SearchParams }) {
  const t = useTranslations("bookingReport");

  const columns: DataTableColumn<BookingReportRow>[] = [
    {
      id: "customer",
      header: t("fields.customer"),
      cell: ({ row }) => (
        <div className="min-w-40">
          <div className="font-medium">{row.original.customer.fullName}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.customer.customerCode} · {row.original.contract.contractCode}
          </div>
        </div>
      ),
    },
    { id: "phone", header: t("fields.phone"), cell: ({ row }) => row.original.customer.phone ?? <HiddenValue /> },
    {
      id: "scheduled",
      header: t("fields.scheduled"),
      cell: ({ row }) => <DateTime value={row.original.scheduledStart} format="dateTime" />,
    },
    {
      id: "checkIn",
      header: t("fields.checkIn"),
      cell: ({ row }) =>
        row.original.checkedInAt ? <DateTime value={row.original.checkedInAt} format="dateTime" /> : "—",
    },
    {
      id: "checkOut",
      header: t("fields.checkOut"),
      cell: ({ row }) =>
        row.original.checkedOutAt ? <DateTime value={row.original.checkedOutAt} format="dateTime" /> : "—",
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <SessionStatusBadge rule={row.original.status} />
          {row.original.type === "BURN_SHOW" && <Badge variant="info">{t("types.BURN_SHOW")}</Badge>}
        </div>
      ),
    },
    { id: "staff", header: t("fields.staff"), cell: ({ row }) => row.original.staff.fullName },
    {
      id: "created",
      header: t("fields.created"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} format="dateTime" />,
    },
  ];

  return (
    <div className="min-w-0">
      <DataTable
        columns={columns}
        data={result.items}
        label={t("title")}
        empty={<EmptyState icon={ClipboardListIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/reports/bookings"
            params={params}
          />
        }
      />
    </div>
  );
}
