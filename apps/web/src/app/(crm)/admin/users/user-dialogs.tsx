"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { CheckboxListField, SelectField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { createUserSchema } from "@flow/shared/users";
import { createUserAction, resetUserPasswordAction } from "./actions";

export type Option = { id: string; name: string };
type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Runs an action, shows field errors and a toast on failure, and returns success. */
export function useSubmit() {
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const run = <T,>(
    action: () => Promise<ActionResult<T>>,
    onError: (fieldErrors?: Record<string, string[]>) => void,
    onSuccess: (data: T) => void,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) return onSuccess(result.data);
      onError(result.fieldErrors);
      notify.error(errorMessage(result.code));
    });

  return { pending, run };
}

type CreateUserValues = { name: string; email: string; roleId: string; password: string; allBranches: boolean; branchIds: string[] };

export function CreateUserDialog({ open, onOpenChange, roles, branches }: DialogProps & { roles: Option[]; branches: Option[] }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema, undefined, { raw: true }) as never,
    // With a single branch there is nothing to choose.
    defaultValues: { name: "", email: "", roleId: "", password: "", allBranches: false, branchIds: branches.length === 1 ? [branches[0].id] : [] },
  });
  const allBranches = useWatch({ control: form.control, name: "allBranches" });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => createUserAction({ ...values, branchIds: values.allBranches ? [] : values.branchIds }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      ({ id, name }) => {
        notify.success(t("users.created", { name }));
        form.reset();
        onOpenChange(false);
        router.push(`/admin/users/${id}`);
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("users.create")}</DialogTitle>
            <DialogDescription>{t("users.createDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField control={form.control} name="name" label={t("users.fields.name")} autoComplete="off" />
            <TextField control={form.control} name="email" label={t("users.fields.email")} type="email" autoComplete="off" />
            <SelectField
              control={form.control}
              name="roleId"
              label={t("users.fields.role")}
              placeholder={t("users.rolePlaceholder")}
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
            />
            <SwitchField control={form.control} name="allBranches" label={t("users.allBranches")} description={t("users.allBranchesHint")} />
            {!allBranches && (
              <CheckboxListField
                control={form.control}
                name="branchIds"
                label={t("users.fields.branches")}
                options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              />
            )}
            <TextField
              control={form.control}
              name="password"
              label={t("users.fields.password")}
              description={t("users.passwordHint")}
              type="password"
              autoComplete="new-password"
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("users.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({ open, onOpenChange, user }: DialogProps & { user: { id: string; name: string } }) {
  const t = useTranslations();
  const { pending, run } = useSubmit();
  const form = useForm<{ password: string }>({ defaultValues: { password: "" } });

  const onSubmit = form.handleSubmit(({ password }) =>
    run(
      () => resetUserPasswordAction({ userId: user.id, password }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("users.passwordReset"));
        form.reset();
        onOpenChange(false);
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("users.resetPasswordTitle", { name: user.name })}</DialogTitle>
            <DialogDescription>{t("users.resetPasswordDescription")}</DialogDescription>
          </DialogHeader>
          <TextField
            control={form.control}
            name="password"
            label={t("users.fields.newPassword")}
            description={t("users.passwordHint")}
            type="password"
            autoComplete="new-password"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("users.resetPassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
