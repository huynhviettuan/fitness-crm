"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, PencilIcon } from "lucide-react";
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
import { SelectField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { SessionStatusBadge } from "@/components/status-badge";
import { notify } from "@/components/notify";
import { STATUS_COLORS, sessionStatusInputSchema, type SessionStatus } from "@gymcrm/shared/bookings";
import { useSubmit } from "../users/user-dialogs";
import { updateSessionStatusAction } from "./actions";

const yes = <CheckIcon className="size-4 text-success" aria-hidden />;

/** The statuses and their rules; a change applies to the next status change only (T-050). */
export function SessionStatusesTable({ statuses }: { statuses: SessionStatus[] }) {
  const t = useTranslations("sessionStatuses");
  const locale = useLocale();
  const [editing, setEditing] = useState<SessionStatus | null>(null);

  const flag = (on: boolean, label: string) =>
    on ? <span aria-label={label}>{yes}</span> : <span aria-hidden>—</span>;
  const columns: DataTableColumn<SessionStatus>[] = [
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <SessionStatusBadge rule={row.original} />,
    },
    {
      id: "code",
      header: t("fields.code"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: "consumes",
      header: t("fields.consumes"),
      cell: ({ row }) => flag(row.original.consumes, t("fields.consumes")),
    },
    {
      id: "creditsPt",
      header: t("fields.creditsPt"),
      cell: ({ row }) => flag(row.original.creditsPt, t("fields.creditsPt")),
    },
    {
      id: "holdsSlot",
      header: t("fields.holdsSlot"),
      cell: ({ row }) => flag(row.original.holdsSlot, t("fields.holdsSlot")),
    },
    {
      id: "locksOnSet",
      header: t("fields.locksOnSet"),
      cell: ({ row }) => flag(row.original.locksOnSet, t("fields.locksOnSet")),
    },
    {
      id: "color",
      header: t("fields.color"),
      cell: ({ row }) => <Badge variant="outline">{t(`colors.${row.original.color}`)}</Badge>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(row.original)}
          aria-label={t("rowActions", { name: locale === "vi" ? row.original.labelVi : row.original.labelEn })}
        >
          <PencilIcon />
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={statuses} label={t("title")} empty={null} getRowId={(row) => row.code} />
      <p className="mt-3 text-xs text-muted-foreground">{t("note")}</p>
      {editing && <StatusDialog status={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type FormValues = {
  labelVi: string;
  labelEn: string;
  consumes: boolean;
  creditsPt: boolean;
  locksOnSet: boolean;
  color: string;
};

function StatusDialog({ status, onClose }: { status: SessionStatus; onClose: () => void }) {
  const t = useTranslations("sessionStatuses");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<FormValues>({
    resolver: zodResolver(sessionStatusInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      labelVi: status.labelVi,
      labelEn: status.labelEn,
      consumes: status.consumes,
      creditsPt: status.creditsPt,
      locksOnSet: status.locksOnSet,
      color: status.color,
    },
  });
  // Booking itself never consumes, credits, or locks (D-025).
  const fixed = status.code === "BOOKED" || status.code === "DELETED";

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => updateSessionStatusAction(status.code, values as never),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
        onClose();
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("editTitle", { code: status.code })}</DialogTitle>
            <DialogDescription>{fixed ? t("bookedFixed") : t("editBody")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField control={form.control} name="labelVi" label={t("fields.labelVi")} autoComplete="off" />
            <TextField control={form.control} name="labelEn" label={t("fields.labelEn")} autoComplete="off" />
            <SelectField
              control={form.control}
              name="color"
              label={t("fields.color")}
              options={STATUS_COLORS.map((color) => ({ value: color, label: t(`colors.${color}`) }))}
            />
            {!fixed && (
              <>
                <SwitchField control={form.control} name="consumes" label={t("fields.consumes")} />
                <SwitchField control={form.control} name="creditsPt" label={t("fields.creditsPt")} />
                <SwitchField control={form.control} name="locksOnSet" label={t("fields.locksOnSet")} />
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? common("saving") : common("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
