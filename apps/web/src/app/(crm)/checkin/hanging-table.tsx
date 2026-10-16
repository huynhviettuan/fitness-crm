"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { SessionStatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import type { HangingSession } from "@gymcrm/shared/checkin";
import { cancelBookingAction, completeSessionAction, markNoShowAction } from "../bookings/actions";
import { requestManualConfirmationAction } from "./actions";

type Props = {
  rows: HangingSession[];
  /** Admin's choice: confirm Đã tập. */
  canComplete: boolean;
  /** The PT's choices at the end of the day (D-071). */
  canAnswer: boolean;
};

/**
 * Sessions that lack a full check-in (D-070, D-071) and the answers: the customer trained but forgot to scan (a request
 * to the admin, who confirms Đã tập), or did not come (Khách không đến or Hủy lịch, as it really happened).
 */
export function HangingTable({ rows, canComplete, canAnswer }: Props) {
  const t = useTranslations("checkin");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<ActionResult<unknown>>, done: string) => {
    setBusy(id);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return;
    }
    notify.success(done);
    router.refresh();
  };

  const columns: DataTableColumn<HangingSession>[] = [
    {
      id: "time",
      header: t("fields.time"),
      cell: ({ row }) => <DateTime value={row.original.booking.scheduledStart} format="dateTime" />,
    },
    { id: "customer", header: t("fields.customer"), cell: ({ row }) => row.original.booking.customer.fullName },
    { id: "trainer", header: t("fields.trainer"), cell: ({ row }) => row.original.booking.trainer.fullName },
    {
      id: "reason",
      header: t("fields.reason"),
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          {row.original.reason && <Badge variant="warning">{t(`reasons.${row.original.reason}`)}</Badge>}
          {row.original.requested && <Badge variant="info">{t("requested")}</Badge>}
          <SessionStatusBadge rule={row.original.booking.statusRule} />
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("fields.actions")}</span>,
      cell: ({ row }) => {
        const id = row.original.booking.id;
        const disabled = busy === id;
        return (
          <span className="flex flex-wrap justify-end gap-2">
            {canComplete && (
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => run(id, () => completeSessionAction(id), t("completed"))}
              >
                {t("actions.complete")}
              </Button>
            )}
            {canAnswer && !row.original.requested && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => run(id, () => requestManualConfirmationAction(id), t("requestSent"))}
              >
                {t("actions.forgotScan")}
              </Button>
            )}
            {canAnswer && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => run(id, () => markNoShowAction(id), t("markedNoShow"))}
                >
                  {t("actions.noShow")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => run(id, () => cancelBookingAction(id), t("cancelled"))}
                >
                  {t("actions.cancel")}
                </Button>
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      label={t("views.hanging")}
      empty={<p className="p-6 text-center text-sm text-muted-foreground">{t("hangingEmpty")}</p>}
      getRowId={(row) => row.booking.id}
    />
  );
}
