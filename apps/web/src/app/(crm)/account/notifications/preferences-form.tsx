"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { notificationText, notificationTitle, type NotificationPreferences } from "@flow/shared/notifications";
import { savePreferencesAction } from "./actions";

/** The kinds of notification that also reach the employee by email and on the phone, each with two switches (D-053). */
export function PreferencesForm({ preferences }: { preferences: NotificationPreferences }) {
  const t = useTranslations("staffNotifications");
  const common = useTranslations("common");
  const locale = useLocale() === "en" ? "en" : "vi";
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(preferences.items);

  const change = (kind: string, channel: "email" | "push", value: boolean) =>
    setItems((current) => current.map((item) => (item.kind === kind ? { ...item, [channel]: value } : item)));

  const save = () =>
    startTransition(async () => {
      const result = await savePreferencesAction({
        items: items.map(({ kind, email, push }) => ({ kind, email, push })),
      });
      if (!result.ok) return void notify.error(errorMessage(result.code));
      notify.success(t("saved"));
      router.refresh();
    });

  return (
    <Card role="region" aria-label={t("choices")}>
      <CardHeader>
        <CardTitle>{t("choices")}</CardTitle>
        <CardDescription>{t("choicesHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table aria-label={t("choices")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.kind")}</TableHead>
              <TableHead>{t("fields.email")}</TableHead>
              <TableHead>{t("fields.push")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const title = notificationTitle(item.kind, locale);
              return (
                <TableRow key={item.kind}>
                  <TableCell>
                    <div className="font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">
                      {notificationText(item.kind, SAMPLE_PARAMS, locale)}
                    </div>
                  </TableCell>
                  {(["email", "push"] as const).map((channel) => {
                    const mandatory = channel === "email" ? item.emailMandatory : item.pushMandatory;
                    return (
                      <TableCell key={channel}>
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={`${title} · ${t(`fields.${channel}`)}`}
                            checked={mandatory || item[channel]}
                            disabled={mandatory}
                            onCheckedChange={(value) => change(item.kind, channel, value)}
                          />
                          {mandatory && <Badge variant="info">{t("mandatory")}</Badge>}
                        </div>
                      </TableCell>
                    );
                  })}
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

const SAMPLE_PARAMS = {
  title: "…",
  due: "…",
  hours: "…",
  code: "…",
  name: "…",
  minutes: "…",
  customer: "…",
  trainer: "…",
};
