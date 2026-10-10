"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PencilIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import type { ErrorCode, FieldErrors } from "@/lib/api/errors";
import { trainerInputSchema } from "@flow/shared/trainers";
import { createTrainerAction, updateTrainerAction } from "./actions";

export type TrainerRow = {
  id: string;
  trainerCode: string;
  fullName: string;
  branch: { id: string; name: string };
  status: "ACTIVE" | "INACTIVE";
  user: { id: string; name: string; email: string } | null;
};

type BranchOption = { id: string; name: string };

export type TrainerLoginOption = { id: string; name: string; email: string; linkedTrainerId: string | null };

// A Select item cannot have an empty value, so "no login" has its own.
const NO_LOGIN = "none";
const trainerFormSchema = trainerInputSchema.extend({ userId: z.string() });

type TrainerFormValues = { branchId: string; fullName: string; status: "ACTIVE" | "INACTIVE"; userId: string };

export function TrainersTable({
  trainers,
  logins,
  branches,
}: {
  trainers: TrainerRow[];
  logins: TrainerLoginOption[];
  branches: BranchOption[];
}) {
  const t = useTranslations("trainers");
  const [editing, setEditing] = useState<TrainerRow | null>(null);

  const columns: DataTableColumn<TrainerRow>[] = [
    { id: "trainerCode", header: t("fields.trainerCode"), cell: ({ row }) => <span className="font-mono text-sm">{row.original.trainerCode}</span> },
    { id: "fullName", header: t("fields.fullName"), cell: ({ row }) => row.original.fullName },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    {
      id: "login",
      header: t("fields.login"),
      cell: ({ row }) =>
        row.original.user ? (
          <span>
            {row.original.user.name} <span className="text-muted-foreground">· {row.original.user.email}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t("noLogin")}</span>
        ),
    },
    { id: "status", header: t("fields.status"), cell: ({ row }) => <StatusBadge entity="trainer" status={row.original.status} /> },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
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
        data={trainers}
        label={t("title")}
        empty={<EmptyState icon={UserPlusIcon} title={t("emptyTitle")} description={t("emptyBody")} />}
        getRowId={(row) => row.id}
      />
      <TrainerDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        trainer={editing}
        logins={logins}
        branches={branches}
      />
    </>
  );
}

export function CreateTrainerButton({ logins, branches }: { logins: TrainerLoginOption[]; branches: BranchOption[] }) {
  const t = useTranslations("trainers");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("create")}
      </Button>
      <TrainerDialog open={open} onOpenChange={setOpen} trainer={null} logins={logins} branches={branches} />
    </>
  );
}

type TrainerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null to create a new trainer. */
  trainer: TrainerRow | null;
  logins: TrainerLoginOption[];
  /** The branches the user works in; asked only when there is more than one (D-014). */
  branches: BranchOption[];
};

function TrainerDialog({ open, onOpenChange, trainer, logins, branches }: TrainerDialogProps) {
  const t = useTranslations("trainers");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{trainer ? t("edit") : t("create")}</DialogTitle>
          <DialogDescription>{trainer ? t("editDescription") : t("createDescription")}</DialogDescription>
        </DialogHeader>
        <TrainerForm trainer={trainer} logins={logins} branches={branches} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TrainerForm({
  trainer,
  logins,
  branches,
  onDone,
}: Omit<TrainerDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<TrainerFormValues>({
    resolver: zodResolver(trainerFormSchema, undefined, { raw: true }) as never,
    defaultValues: {
      branchId: trainer?.branch.id ?? "",
      fullName: trainer?.fullName ?? "",
      status: trainer?.status ?? "ACTIVE",
      userId: trainer?.user?.id ?? NO_LOGIN,
    },
  });

  // A login already linked to another trainer cannot be chosen (A-010).
  const loginOptions = [
    { value: NO_LOGIN, label: t("trainers.noLogin") },
    ...logins
      .filter((login) => !login.linkedTrainerId || login.linkedTrainerId === trainer?.id)
      .map((login) => ({ value: login.id, label: `${login.name} · ${login.email}` })),
  ];

  const showErrors = (result: { code: ErrorCode; fieldErrors?: FieldErrors }) => {
    applyFieldErrors(form.setError, result.fieldErrors);
    notify.error(errorMessage(result.code));
  };

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const input = { ...values, userId: values.userId === NO_LOGIN ? "" : values.userId };
      let message: string;
      if (trainer) {
        const result = await updateTrainerAction(trainer.id, input);
        if (!result.ok) return showErrors(result);
        message = t("trainers.updated");
      } else {
        const result = await createTrainerAction(input);
        if (!result.ok) return showErrors(result);
        message = t("trainers.created", { code: result.data.trainerCode });
      }
      notify.success(message);
      onDone();
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        {branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={t("trainers.fields.branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <TextField control={form.control} name="fullName" label={t("trainers.fields.fullName")} autoComplete="off" />
        {trainer && (
          <SelectField
            control={form.control}
            name="status"
            label={t("trainers.fields.status")}
            options={(["ACTIVE", "INACTIVE"] as const).map((status) => ({ value: status, label: t(`status.trainer.${status}`) }))}
          />
        )}
        <SelectField
          control={form.control}
          name="userId"
          label={t("trainers.fields.login")}
          description={t("trainers.loginDescription")}
          options={loginOptions}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
