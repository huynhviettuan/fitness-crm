"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { NO_OPTION, optionLabel } from "@/components/option-select";
import type { Option } from "@flow/shared/options";
import { notify } from "@/components/notify";
import { parametersInputSchema, type Parameters } from "@flow/shared/parameters";
import { useSubmit } from "../users/user-dialogs";
import { updateParametersAction } from "./actions";

/** All parameters on one form, grouped by what reads them; saved together. */
export function ParametersForm({ parameters, departments }: { parameters: Parameters; departments: Option[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<Parameters>({
    // A drop-down cannot hold "", so "no department" is NO_OPTION on screen.
    resolver: (values, context, options) =>
      zodResolver(parametersInputSchema, undefined, { raw: true })(
        {
          ...values,
          studioDepartmentId: values.studioDepartmentId === NO_OPTION ? "" : values.studioDepartmentId,
        } as never,
        context,
        options as never,
      ) as never,
    defaultValues: { ...parameters, studioDepartmentId: parameters.studioDepartmentId || NO_OPTION },
  });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        updateParametersAction({
          ...values,
          studioDepartmentId: values.studioDepartmentId === NO_OPTION ? "" : values.studioDepartmentId,
        }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("parameters.saved"));
        router.refresh();
      },
    ),
  );

  const field = (name: keyof Parameters, inputMode?: "numeric") => (
    <TextField
      control={form.control}
      name={name}
      label={t(`parameters.fields.${name}`)}
      autoComplete="off"
      inputMode={inputMode}
    />
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
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("leadCodePrefix")}
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
      <Card>
        <CardHeader>
          <CardTitle>{t("parameters.leads")}</CardTitle>
          <CardDescription>{t("parameters.leadsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {field("recareDays", "numeric")}
          <div className="sm:col-span-2">
            <SelectField
              control={form.control}
              name="studioDepartmentId"
              label={t("parameters.fields.studioDepartmentId")}
              description={t("parameters.studioHint")}
              options={[
                { value: NO_OPTION, label: t("parameters.noDepartment") },
                ...departments.map((department) => ({ value: department.id, label: optionLabel(department, locale) })),
              ]}
            />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
