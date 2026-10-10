"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { ROLES, type Role } from "@/lib/permissions";
import { createUserSchema } from "@/modules/users/user.schema";
import { changeUserRoleAction, createUserAction, resetUserPasswordAction } from "./actions";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function useRoleOptions() {
  const t = useTranslations("roles");
  return ROLES.map((role) => ({ value: role, label: t(role) }));
}

/** Runs an action, shows field errors and a toast on failure, and returns success. */
function useSubmit() {
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

type CreateUserValues = { name: string; email: string; role: Role | ""; password: string };

export function CreateUserDialog({ open, onOpenChange }: DialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const roleOptions = useRoleOptions();
  const { pending, run } = useSubmit();
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema, undefined, { raw: true }) as never,
    defaultValues: { name: "", email: "", role: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => createUserAction(values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      ({ name }) => {
        notify.success(t("users.created", { name }));
        form.reset();
        onOpenChange(false);
        router.refresh();
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
              name="role"
              label={t("users.fields.role")}
              placeholder={t("users.rolePlaceholder")}
              options={roleOptions}
            />
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

type TargetUser = { id: string; name: string; role: Role };

export function ChangeRoleDialog({ open, onOpenChange, user }: DialogProps & { user: TargetUser }) {
  const t = useTranslations();
  const router = useRouter();
  const roleOptions = useRoleOptions();
  const { pending, run } = useSubmit();
  const form = useForm<{ role: Role }>({ defaultValues: { role: user.role } });

  const onSubmit = form.handleSubmit(({ role }) =>
    run(
      () => changeUserRoleAction({ userId: user.id, role }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("users.roleChanged"));
        onOpenChange(false);
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("users.changeRoleTitle", { name: user.name })}</DialogTitle>
          </DialogHeader>
          <SelectField control={form.control} name="role" label={t("users.fields.role")} options={roleOptions} />
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

export function ResetPasswordDialog({ open, onOpenChange, user }: DialogProps & { user: TargetUser }) {
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
