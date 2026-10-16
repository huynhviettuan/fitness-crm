"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, ScrollTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { scriptInputSchema, type ConsultingScript } from "@gymcrm/shared/leads";
import { useSubmit } from "../users/user-dialogs";
import { createScriptAction, reorderScriptsAction, updateScriptAction } from "./actions";

export function CreateScriptButton() {
  const t = useTranslations("scripts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("create")}
      </Button>
      {open && <ScriptDialog script={null} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every script in its order, inactive ones too; arrows move a script (A-072). */
export function ScriptsTable({ scripts }: { scripts: ConsultingScript[] }) {
  const t = useTranslations("scripts");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const [editing, setEditing] = useState<ConsultingScript | null>(null);

  const move = (index: number, by: -1 | 1) => {
    const ids = scripts.map((script) => script.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    run(
      () => reorderScriptsAction(ids),
      () => {},
      () => {
        notify.success(t("reordered"));
        router.refresh();
      },
    );
  };

  const columns: DataTableColumn<ConsultingScript>[] = [
    {
      id: "order",
      header: t("fields.order"),
      cell: ({ row }) => {
        const index = scripts.findIndex((script) => script.id === row.original.id);
        return (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={pending || index === 0}
              onClick={() => move(index, -1)}
              aria-label={t("moveUp", { name: row.original.situationVi })}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pending || index === scripts.length - 1}
              onClick={() => move(index, 1)}
              aria-label={t("moveDown", { name: row.original.situationVi })}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        );
      },
    },
    {
      id: "situationVi",
      header: t("fields.situationVi"),
      cell: ({ row }) => <span className="font-medium">{row.original.situationVi}</span>,
    },
    { id: "situationEn", header: t("fields.situationEn"), cell: ({ row }) => row.original.situationEn },
    {
      id: "answers",
      header: t("fields.answers"),
      cell: ({ row }) =>
        row.original.answerVi || row.original.answerEn ? (
          <span className="flex gap-1">
            {row.original.answerVi && <Badge variant="outline">VI</Badge>}
            {row.original.answerEn && <Badge variant="outline">EN</Badge>}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("noAnswer")}</span>
        ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="option" status={row.original.active ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(row.original)}
          aria-label={t("rowActions", { name: row.original.situationVi })}
        >
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
        data={scripts}
        label={t("title")}
        empty={<EmptyState icon={ScrollTextIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {editing && <ScriptDialog script={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type ScriptFormValues = {
  situationVi: string;
  situationEn: string;
  answerVi: string;
  answerEn: string;
  active: boolean;
};

function ScriptDialog({ script, onClose }: { script: ConsultingScript | null; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<ScriptFormValues>({
    resolver: zodResolver(scriptInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      situationVi: script?.situationVi ?? "",
      situationEn: script?.situationEn ?? "",
      answerVi: script?.answerVi ?? "",
      answerEn: script?.answerEn ?? "",
      active: script?.active ?? true,
    },
  });

  const done = (message: string) => {
    notify.success(message);
    onClose();
    router.refresh();
  };
  const onSubmit = form.handleSubmit((values) => {
    const showErrors = (fieldErrors?: Record<string, string[]>) => applyFieldErrors(form.setError, fieldErrors);
    if (script)
      run(
        () => updateScriptAction(script.id, values),
        showErrors,
        () => done(t("scripts.saved")),
      );
    else
      run(
        () => createScriptAction(values),
        showErrors,
        ({ name }) => done(t("scripts.created", { name })),
      );
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{script ? t("scripts.edit") : t("scripts.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="max-h-[60vh] overflow-y-auto px-1">
            <TextField
              control={form.control}
              name="situationVi"
              label={t("scripts.fields.situationVi")}
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="situationEn"
              label={t("scripts.fields.situationEn")}
              autoComplete="off"
            />
            <TextField control={form.control} name="answerVi" label={t("scripts.fields.answerVi")} multiline />
            <TextField control={form.control} name="answerEn" label={t("scripts.fields.answerEn")} multiline />
            {script && <SwitchField control={form.control} name="active" label={t("scripts.fields.active")} />}
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
