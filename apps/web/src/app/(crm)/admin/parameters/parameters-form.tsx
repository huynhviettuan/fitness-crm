"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { parametersInputSchema, type Parameters } from "@flow/shared/parameters";
import { useSubmit } from "../users/user-dialogs";
import { updateParametersAction } from "./actions";

/** All parameters on one form, grouped by what reads them; saved together. */
export function ParametersForm({ parameters }: { parameters: Parameters }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<Parameters>({
    resolver: zodResolver(parametersInputSchema, undefined, { raw: true }) as never,
    defaultValues: parameters,
  });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => updateParametersAction(values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("parameters.saved"));
        router.refresh();
      },
    ),
  );

  const field = (name: keyof Parameters, inputMode?: "numeric") => (
    <TextField control={form.control} name={name} label={t(`parameters.fields.${name}`)} autoComplete="off" inputMode={inputMode} />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("parameters.calendar")}</CardTitle>
          <CardDescription>{t("parameters.calendarHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("calendarDayStart", "numeric")}
          {field("calendarDayEnd", "numeric")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("parameters.codes")}</CardTitle>
          <CardDescription>{t("parameters.codesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {field("customerCodePrefix")}
          {field("contractCodePrefix")}
          {field("employeeCodePrefix")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("parameters.tasks")}</CardTitle>
          <CardDescription>{t("parameters.tasksHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">{field("taskDueSoonHours", "numeric")}</CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
