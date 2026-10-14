"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import {
  emailTemplateInputSchema,
  renderTemplate,
  sampleValues,
  type EmailLocale,
  type EmailTemplateView,
} from "@flow/shared/mail";
import { updateEmailTemplateAction } from "../actions";

type Values = { subjectVi: string; bodyVi: string; subjectEn: string; bodyEn: string };

const LANGUAGES = [
  { locale: "vi", subject: "subjectVi", body: "bodyVi" },
  { locale: "en", subject: "subjectEn", body: "bodyEn" },
] as const satisfies readonly { locale: EmailLocale; subject: keyof Values; body: keyof Values }[];

/** Edits the words of one customer email in both languages, with its placeholders and a preview (FR-MAIL-001). */
export function TemplateEditor({ template }: { template: EmailTemplateView }) {
  const t = useTranslations("emailTemplates");
  const common = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(emailTemplateInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      subjectVi: template.subjectVi,
      bodyVi: template.bodyVi,
      subjectEn: template.subjectEn,
      bodyEn: template.bodyEn,
    },
  });
  const values = useWatch({ control: form.control });

  const onSubmit = form.handleSubmit((input) =>
    startTransition(async () => {
      const result = await updateEmailTemplateAction(template.event, input);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("saved"));
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-4xl space-y-6">
      <Card role="region" aria-label={t("placeholders")}>
        <CardHeader>
          <CardTitle>{t("placeholders")}</CardTitle>
          <CardDescription>{t("placeholdersHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {template.placeholders.map((placeholder) => (
              <li key={placeholder.name}>
                <Badge
                  variant={placeholder.required ? "info" : "muted"}
                  title={locale === "vi" ? placeholder.labelVi : placeholder.labelEn}
                >
                  {`{${placeholder.name}}`}
                  <span className="sr-only"> · {locale === "vi" ? placeholder.labelVi : placeholder.labelEn}</span>
                  {placeholder.required && <span> · {t("required")}</span>}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {LANGUAGES.map((language) => {
        const subject = renderTemplate(values[language.subject] ?? "", sampleValues(language.locale));
        const body = renderTemplate(values[language.body] ?? "", sampleValues(language.locale));
        return (
          <Card key={language.locale} role="region" aria-label={t(`languages.${language.locale}`)}>
            <CardHeader>
              <CardTitle>{t(`languages.${language.locale}`)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <FieldGroup>
                <TextField control={form.control} name={language.subject} label={t("subject")} autoComplete="off" />
                <TextField control={form.control} name={language.body} label={t("body")} multiline />
              </FieldGroup>
              <div
                role="region"
                aria-label={t("previewOf", { language: t(`languages.${language.locale}`) })}
                className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm"
              >
                <p className="text-xs font-medium text-muted-foreground uppercase">{t("preview")}</p>
                <p className="font-medium" data-testid={`preview-subject-${language.locale}`}>
                  {subject}
                </p>
                <p className="whitespace-pre-wrap" data-testid={`preview-body-${language.locale}`}>
                  {body}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? common("saving") : common("save")}
        </Button>
      </div>
    </form>
  );
}
