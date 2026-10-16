"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth-client";

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setFailed(false);
    startTransition(async () => {
      const { error } = await authClient.signIn.email({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      });
      // One message for every failure, so the form never reveals which accounts exist.
      if (error) return setFailed(true);
      router.replace("/dashboard");
      router.refresh();
    });
  };

  return (
    <form action={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={emailId}>{t("email")}</FieldLabel>
          <Input id={emailId} name="email" type="email" autoComplete="username" required />
        </Field>
        <Field>
          <FieldLabel htmlFor={passwordId}>{t("password")}</FieldLabel>
          <Input id={passwordId} name="password" type="password" autoComplete="current-password" required />
        </Field>
        {failed && <FieldError>{t("invalid")}</FieldError>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
