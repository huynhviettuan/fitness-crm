"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OctagonAlertIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { ChosenOptionText } from "@/components/option-select";
import { escalationSeenSchema, type Escalation } from "@flow/shared/workouts";
import { useSubmit } from "../../admin/users/user-dialogs";
import { markSeenAction } from "./actions";

/** The escalations, each with the session it was raised in; a waiting one is closed with a direction (brief §7.4). */
export function EscalationsTable({ escalations, label }: { escalations: Escalation[]; label: string }) {
  const t = useTranslations("workoutEscalations");
  const [closing, setClosing] = useState<Escalation | null>(null);
  const columns: DataTableColumn<Escalation>[] = [
    {
      id: "raised",
      header: t("fields.raisedAt"),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/logs/${row.original.logId}`}>
          <DateTime value={row.original.raisedAt} format="dateTime" />
        </Link>
      ),
    },
    {
      id: "customer",
      header: t("fields.customer"),
      cell: ({ row }) => `${row.original.customer.fullName} · ${row.original.customer.customerCode}`,
    },
    { id: "trainer", header: t("fields.trainer"), cell: ({ row }) => row.original.trainer.fullName },
    {
      id: "exercise",
      header: t("fields.exercise"),
      cell: ({ row }) => t("exerciseSet", { exercise: row.original.exercise.name, set: row.original.setNo }),
    },
    { id: "flag", header: t("fields.flag"), cell: ({ row }) => <ChosenOptionText option={row.original.flag} /> },
    { id: "note", header: t("fields.note"), cell: ({ row }) => row.original.note ?? "—" },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) =>
        row.original.status === "WAITING" ? (
          <Badge variant="warning">{t("status.WAITING")}</Badge>
        ) : (
          <div className="space-y-1">
            <Badge variant="success">{t("status.SEEN")}</Badge>
            <p className="text-xs text-muted-foreground">
              {row.original.seenBy?.name}: {row.original.direction}
            </p>
          </div>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.canMarkSeen ? (
          <Button size="sm" variant="outline" onClick={() => setClosing(row.original)}>
            {t("markSeen")}
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={escalations}
        label={label}
        empty={<EmptyState icon={OctagonAlertIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {closing && <SeenDialog escalation={closing} onClose={() => setClosing(null)} />}
    </>
  );
}

function SeenDialog({ escalation, onClose }: { escalation: Escalation; onClose: () => void }) {
  const t = useTranslations("workoutEscalations");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<{ direction: string }>({
    resolver: zodResolver(escalationSeenSchema as never) as never,
    defaultValues: { direction: "" },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => markSeenAction(escalation.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("seen"));
        onClose();
        router.refresh();
      },
    ),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("markSeen")}</DialogTitle>
          <DialogDescription>
            {escalation.customer.fullName} · {escalation.exercise.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FieldGroup>
            <TextField control={form.control} name="direction" label={t("fields.direction")} multiline />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? common("saving") : t("confirmSeen")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
