"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { notificationTitle, type NotificationSettings } from "@gymcrm/shared/notifications";
import { saveSettingsAction } from "./actions";

/** Admin marks, per kind of notification, whether the email and the push are mandatory (D-053). */
export function SettingsForm({ settings }: { settings: NotificationSettings }) {
  const t = useTranslations("notificationSettings");
  const common = useTranslations("common");
  const locale = useLocale() === "en" ? "en" : "vi";
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(settings.items);

  const change = (kind: string, field: "emailMandatory" | "pushMandatory", value: boolean) =>
    setItems((current) => current.map((item) => (item.kind === kind ? { ...item, [field]: value } : item)));

  const save = () =>
    startTransition(async () => {
      const result = await saveSettingsAction({ items });
      if (!result.ok) return void notify.error(errorMessage(result.code));
      notify.success(t("saved"));
      router.refresh();
    });

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4">
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.kind")}</TableHead>
              <TableHead>{t("fields.emailMandatory")}</TableHead>
              <TableHead>{t("fields.pushMandatory")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const title = notificationTitle(item.kind, locale);
              return (
                <TableRow key={item.kind}>
                  <TableCell className="font-medium">{title}</TableCell>
                  {(["emailMandatory", "pushMandatory"] as const).map((field) => (
                    <TableCell key={field}>
                      <Switch
                        aria-label={`${title} · ${t(`fields.${field}`)}`}
                        checked={item[field]}
                        onCheckedChange={(value) => change(item.kind, field, value)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? common("saving") : common("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
