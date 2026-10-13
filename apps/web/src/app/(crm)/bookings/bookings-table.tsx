"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import { BookingFormDialog, type BookingPreset } from "./booking-form";
import { BookingSheet } from "./booking-sheet";
import type { BookingPermissions, BookingRow, TrainerOption } from "./booking-types";

type BookingsTableProps = {
  bookings: BookingRow[];
  permissions: BookingPermissions;
  trainers: TrainerOption[];
  /** Accessible name of the table. */
  label: string;
  /** Hide columns the page already shows, e.g. the customer on a customer's page. */
  hide?: { customer?: boolean; contract?: boolean };
  empty: ReactNode;
  footer?: ReactNode;
};

/** Bookings as rows; "Open" shows the booking sheet with its actions. */
export function BookingsTable({
  bookings,
  permissions,
  trainers,
  label,
  hide = {},
  empty,
  footer,
}: BookingsTableProps) {
  const t = useTranslations("bookings");
  const contractsT = useTranslations("contracts");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Looked up on every render, so the sheet shows the refreshed booking after an action.
  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  const columns: DataTableColumn<BookingRow>[] = [
    { id: "date", header: t("fields.date"), cell: ({ row }) => <DateTime value={row.original.scheduledStart} /> },
    {
      id: "time",
      header: t("fields.time"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          <DateTime value={row.original.scheduledStart} format="time" />–
          <DateTime value={row.original.scheduledEnd} format="time" />
        </span>
      ),
    },
    ...(hide.customer
      ? []
      : [
          {
            id: "customer",
            header: t("fields.customer"),
            cell: ({ row }) => (
              <Link href={`/customers/${row.original.customer.id}`} className="hover:underline">
                {row.original.customer.fullName}
              </Link>
            ),
          } satisfies DataTableColumn<BookingRow>,
        ]),
    ...(hide.contract
      ? []
      : [
          {
            id: "contract",
            header: t("fields.contract"),
            cell: ({ row }) => (
              <Link href={`/contracts/${row.original.contract.id}`} className="font-mono text-sm hover:underline">
                {row.original.contract.contractCode}
              </Link>
            ),
          } satisfies DataTableColumn<BookingRow>,
        ]),
    { id: "trainer", header: t("fields.trainer"), cell: ({ row }) => row.original.trainer.fullName },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge entity="booking" status={row.original.status} />
          {/* A booked session of a deactivated contract is for admin to deal with (D-023). */}
          {row.original.contract.frozen && row.original.status === "BOOKED" && (
            <Badge variant="warning">{contractsT("frozenBooking")}</Badge>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("details")}</span>,
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => setSelectedId(row.original.id)}>
          {t("open")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={bookings}
        label={label}
        empty={empty}
        footer={footer}
        getRowId={(row) => row.id}
      />
      <BookingSheet
        booking={selected}
        onClose={() => setSelectedId(null)}
        permissions={permissions}
        trainers={trainers}
      />
    </>
  );
}

/** "Add booking", optionally with the customer, contract, trainer, or time already chosen. */
export function AddBookingButton({ trainers, preset }: { trainers: TrainerOption[]; preset?: BookingPreset }) {
  const t = useTranslations("bookings");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlusIcon />
        {t("create")}
      </Button>
      <BookingFormDialog open={open} onOpenChange={setOpen} mode="create" preset={preset} trainers={trainers} />
    </>
  );
}
