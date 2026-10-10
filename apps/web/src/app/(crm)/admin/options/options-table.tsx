"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownIcon, ArrowUpIcon, ListChecksIcon, MessageSquareTextIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { optionInputSchema, type Option, type OptionListKey, type OtherNote } from "@flow/shared/options";
import { useSubmit } from "../users/user-dialogs";
import { createOptionAction, reorderOptionsAction, updateOptionAction } from "./actions";

export function CreateOptionButton({ listKey }: { listKey: OptionListKey }) {
  const t = useTranslations("options");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("create")}
      </Button>
      {open && <OptionDialog listKey={listKey} option={null} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The options of one list in their order (FR-PLT-005). Arrows move an option; "Khác"
 * is always last, so it has none and cannot be switched off.
 */
export function OptionsTable({ listKey, options, label }: { listKey: OptionListKey; options: Option[]; label: string }) {
  const t = useTranslations("options");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const [editing, setEditing] = useState<Option | null>(null);
  const ordered = options.filter((option) => !option.isOther);

  const move = (index: number, by: -1 | 1) => {
    const ids = ordered.map((option) => option.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    run(
      () => reorderOptionsAction(listKey, ids),
      () => {},
      () => {
        notify.success(t("reordered"));
        router.refresh();
      },
    );
  };

  const columns: DataTableColumn<Option>[] = [
    {
      id: "order",
      header: t("fields.order"),
      cell: ({ row }) => {
        if (row.original.isOther) return null;
        const index = ordered.findIndex((option) => option.id === row.original.id);
        return (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={pending || index === 0}
              onClick={() => move(index, -1)}
              aria-label={t("moveUp", { name: row.original.labelVi })}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pending || index === ordered.length - 1}
              onClick={() => move(index, 1)}
              aria-label={t("moveDown", { name: row.original.labelVi })}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        );
      },
    },
    {
      id: "labelVi",
      header: t("fields.labelVi"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium">
          {row.original.labelVi}
          {row.original.isOther && (
            <Badge variant="outline" title={t("otherHint")}>
              {t("other")}
            </Badge>
          )}
        </span>
      ),
    },
    { id: "labelEn", header: t("fields.labelEn"), cell: ({ row }) => row.original.labelEn },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="option" status={row.original.active ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)} aria-label={t("rowActions", { name: row.original.labelVi })}>
          <PencilIcon />
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={options}
        label={label}
        empty={<EmptyState icon={ListChecksIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {editing && <OptionDialog listKey={listKey} option={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** What was written with "Khác", most used first (FR-PLT-005). */
export function OtherNotesTable({ notes }: { notes: OtherNote[] }) {
  const t = useTranslations("options.otherNotes");
  const locale = useLocale();
  const columns: DataTableColumn<OtherNote>[] = [
    { id: "note", header: t("note"), cell: ({ row }) => <span className="whitespace-normal">{row.original.note}</span> },
    { id: "count", header: t("count"), cell: ({ row }) => row.original.count.toLocaleString(locale) },
    { id: "lastUsedAt", header: t("lastUsedAt"), cell: ({ row }) => <DateTime value={row.original.lastUsedAt} format="dateTime" /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={notes}
      label={t("title")}
      empty={<EmptyState icon={MessageSquareTextIcon} title={t("empty")} />}
      getRowId={(row) => row.note}
    />
  );
}

type OptionFormValues = { labelVi: string; labelEn: string; active: boolean };

function OptionDialog({ listKey, option, onClose }: { listKey: OptionListKey; option: Option | null; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<OptionFormValues>({
    resolver: zodResolver(optionInputSchema, undefined, { raw: true }) as never,
    defaultValues: { labelVi: option?.labelVi ?? "", labelEn: option?.labelEn ?? "", active: option?.active ?? true },
  });

  const done = (message: string) => {
    notify.success(message);
    onClose();
    router.refresh();
  };
  const onSubmit = form.handleSubmit((values) => {
    const showErrors = (fieldErrors?: Record<string, string[]>) => applyFieldErrors(form.setError, fieldErrors);
    if (option) run(() => updateOptionAction(listKey, option.id, values), showErrors, () => done(t("options.saved")));
    else run(() => createOptionAction(listKey, values), showErrors, ({ name }) => done(t("options.created", { name })));
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{option ? t("options.edit") : t("options.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <TextField control={form.control} name="labelVi" label={t("options.fields.labelVi")} autoComplete="off" />
            <TextField control={form.control} name="labelEn" label={t("options.fields.labelEn")} autoComplete="off" />
            {option && !option.isOther && <SwitchField control={form.control} name="active" label={t("options.fields.active")} />}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
