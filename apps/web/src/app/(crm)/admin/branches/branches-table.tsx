"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { branchInputSchema } from "@flow/shared/branches";
import { useSubmit } from "../users/user-dialogs";
import { createBranchAction, updateBranchAction } from "./actions";

type BranchRow = { id: string; name: string; address: string | null; active: boolean };

export function CreateBranchButton() {
  const t = useTranslations("branches");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("create")}
      </Button>
      <BranchDialog open={open} onOpenChange={setOpen} branch={null} />
    </>
  );
}

export function BranchesTable({ branches }: { branches: BranchRow[] }) {
  const t = useTranslations("branches");
  const [editing, setEditing] = useState<BranchRow | null>(null);

  const columns: DataTableColumn<BranchRow>[] = [
    { id: "name", header: t("fields.name"), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "address", header: t("fields.address"), cell: ({ row }) => row.original.address },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="branch" status={row.original.active ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)} aria-label={t("rowActions", { name: row.original.name })}>
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
        data={branches}
        label={t("title")}
        empty={<EmptyState icon={Building2Icon} title={t("title")} />}
        getRowId={(row) => row.id}
      />
      {editing && <BranchDialog open onOpenChange={(open) => !open && setEditing(null)} branch={editing} />}
    </>
  );
}

type BranchFormValues = { name: string; address: string; active: boolean };

function BranchDialog({ open, onOpenChange, branch }: { open: boolean; onOpenChange: (open: boolean) => void; branch: BranchRow | null }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<BranchFormValues>({
    resolver: zodResolver(branchInputSchema, undefined, { raw: true }) as never,
    defaultValues: { name: branch?.name ?? "", address: branch?.address ?? "", active: branch?.active ?? true },
  });

  const done = (message: string) => {
    notify.success(message);
    form.reset();
    onOpenChange(false);
    router.refresh();
  };
  const onSubmit = form.handleSubmit((values) => {
    const showErrors = (fieldErrors?: Record<string, string[]>) => applyFieldErrors(form.setError, fieldErrors);
    if (branch) run(() => updateBranchAction(branch.id, values), showErrors, () => done(t("branches.saved")));
    else run(() => createBranchAction(values), showErrors, ({ name }) => done(t("branches.created", { name })));
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{branch ? t("branches.edit") : t("branches.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <TextField control={form.control} name="name" label={t("branches.fields.name")} autoComplete="off" />
            <TextField control={form.control} name="address" label={t("branches.fields.address")} autoComplete="off" />
            {branch && <SwitchField control={form.control} name="active" label={t("branches.fields.active")} />}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
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
