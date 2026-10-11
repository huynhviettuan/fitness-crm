"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PencilIcon, UserPlusIcon } from "lucide-react";
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
import { SelectField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { NO_OPTION, OptionSelect } from "@/components/option-select";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ErrorCode, FieldErrors } from "@/lib/api/errors";
import { formatDateOnly } from "@/lib/format";
import { EMPLOYEE_STATUSES, GENDERS, employeeInputSchema, type Employee } from "@flow/shared/employees";
import { createEmployeeAction, updateEmployeeAction } from "./actions";

type BranchOption = { id: string; name: string };
export type EmployeeLoginOption = { id: string; name: string; email: string; linkedEmployeeId: string | null };

// Select items cannot have an empty value, so "none" has its own (sent as "").
const NONE = NO_OPTION;
const formSchema = employeeInputSchema.extend({
  userId: z.string(),
  departmentId: z.string(),
  titleId: z.string(),
  gender: z.string(),
});

type FormValues = {
  branchId: string;
  fullName: string;
  birthDate: string;
  gender: string;
  phone: string;
  email: string;
  departmentId: string;
  departmentNote: string;
  team: string;
  titleId: string;
  titleNote: string;
  status: (typeof EMPLOYEE_STATUSES)[number];
  isTrainer: boolean;
  userId: string;
};

function defaultsOf(employee: Employee | null): FormValues {
  return {
    branchId: employee?.branch.id ?? "",
    fullName: employee?.fullName ?? "",
    birthDate: employee?.birthDate ? formatDateOnly(employee.birthDate) : "",
    gender: employee?.gender ?? NONE,
    phone: employee?.phone ?? "",
    email: employee?.email ?? "",
    departmentId: employee?.department?.id ?? NONE,
    departmentNote: employee?.department?.note ?? "",
    team: employee?.team ?? "",
    titleId: employee?.title?.id ?? NONE,
    titleNote: employee?.title?.note ?? "",
    status: employee?.status ?? "ACTIVE",
    isTrainer: employee?.isTrainer ?? false,
    userId: employee?.user?.id ?? NONE,
  };
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null to add a new employee. */
  employee: Employee | null;
  logins: EmployeeLoginOption[];
  /** The branches the user works in; asked only when there is more than one (D-014). */
  branches: BranchOption[];
};

export function CreateEmployeeButton({
  logins,
  branches,
}: {
  logins: EmployeeLoginOption[];
  branches: BranchOption[];
}) {
  const t = useTranslations("employees");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("create")}
      </Button>
      <EmployeeDialog open={open} onOpenChange={setOpen} employee={null} logins={logins} branches={branches} />
    </>
  );
}

export function EditEmployeeButton({
  employee,
  logins,
  branches,
}: {
  employee: Employee;
  logins: EmployeeLoginOption[];
  branches: BranchOption[];
}) {
  const t = useTranslations("employees");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <EmployeeDialog open={open} onOpenChange={setOpen} employee={employee} logins={logins} branches={branches} />
    </>
  );
}

function EmployeeDialog({ open, onOpenChange, employee, logins, branches }: DialogProps) {
  const t = useTranslations("employees");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{employee ? t("edit") : t("create")}</DialogTitle>
          <DialogDescription>{employee ? t("editDescription") : t("createDescription")}</DialogDescription>
        </DialogHeader>
        {/* Remount per employee, so the form starts from their values. */}
        <EmployeeForm
          key={employee?.id ?? "new"}
          employee={employee}
          logins={logins}
          branches={branches}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EmployeeForm({
  employee,
  logins,
  branches,
  onDone,
}: Omit<DialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema, undefined, { raw: true }) as never,
    defaultValues: defaultsOf(employee),
  });
  const f = useTranslations("employees.fields");

  // A login that already belongs to another employee cannot be chosen (brief §8.4).
  const loginOptions = [
    { value: NONE, label: t("employees.noLogin") },
    ...logins
      .filter((login) => !login.linkedEmployeeId || login.linkedEmployeeId === employee?.id)
      .map((login) => ({ value: login.id, label: `${login.name} · ${login.email}` })),
  ];

  const showErrors = (result: { code: ErrorCode; fieldErrors?: FieldErrors }) => {
    applyFieldErrors(form.setError, result.fieldErrors);
    notify.error(errorMessage(result.code));
  };

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const none = (value: string) => (value === NONE ? "" : value);
      const input = {
        ...values,
        gender: none(values.gender) as "" | (typeof GENDERS)[number],
        departmentId: none(values.departmentId),
        titleId: none(values.titleId),
        userId: none(values.userId),
      };
      if (employee) {
        const result = await updateEmployeeAction(employee.id, input);
        if (!result.ok) return showErrors(result);
        notify.success(t("employees.updated"));
        onDone();
        router.refresh();
      } else {
        const result = await createEmployeeAction(input);
        if (!result.ok) return showErrors(result);
        notify.success(t("employees.created", { code: result.data.employeeCode }));
        onDone();
        router.push(`/employees/${result.data.id}`);
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        {branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={f("branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <TextField control={form.control} name="fullName" label={f("fullName")} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="birthDate"
            label={f("birthDate")}
            placeholder={t("employees.birthDatePlaceholder")}
          />
          <SelectField
            control={form.control}
            name="gender"
            label={f("gender")}
            options={[
              { value: NONE, label: t("employees.noOption") },
              ...GENDERS.map((gender) => ({ value: gender, label: t(`employees.genders.${gender}`) })),
            ]}
          />
          <TextField
            control={form.control}
            name="phone"
            label={f("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="off"
          />
          <TextField control={form.control} name="email" label={f("email")} type="email" autoComplete="off" />
        </div>
        <OptionSelect
          control={form.control}
          name="departmentId"
          noteName="departmentNote"
          listKey="departments"
          label={f("department")}
          noneLabel={t("employees.noOption")}
        />
        <TextField control={form.control} name="team" label={f("team")} autoComplete="off" />
        <OptionSelect
          control={form.control}
          name="titleId"
          noteName="titleNote"
          listKey="jobTitles"
          label={f("title")}
          noneLabel={t("employees.noOption")}
        />
        {employee && (
          <SelectField
            control={form.control}
            name="status"
            label={f("status")}
            options={EMPLOYEE_STATUSES.map((status) => ({ value: status, label: t(`status.employee.${status}`) }))}
          />
        )}
        <SwitchField
          control={form.control}
          name="isTrainer"
          label={f("isTrainer")}
          description={t("employees.isTrainerDescription")}
        />
        <SelectField
          control={form.control}
          name="userId"
          label={f("login")}
          description={t("employees.loginDescription")}
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
