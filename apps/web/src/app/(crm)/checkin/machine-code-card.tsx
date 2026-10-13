"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { MachineSubject } from "@flow/shared/checkin";
import { setMachineCodeAction } from "./actions";

type Props = { subject: MachineSubject; id: string; code: string | null };

/**
 * The user code the fingerprint machine knows this person by (D-072). The CRM keeps only this code, never a
 * fingerprint or face image. Admin sets it, for customers and for staff.
 */
export function MachineCodeCard({ subject, id, code }: Props) {
  const t = useTranslations("checkin");
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(code ?? "");
  const [saved, setSaved] = useState(code ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await setMachineCodeAction(subject, id, value);
    setBusy(false);
    if (!result.ok) {
      notify.error(result.fieldErrors?.code ? t("codeTaken") : errorMessage(result.code));
      return;
    }
    setSaved(result.data.code ?? "");
    notify.success(t("codeSaved"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("machineCode")}</CardTitle>
        <CardDescription>{t("machineCodeHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={t("machineCode")}
          maxLength={40}
          className="max-w-56"
        />
        <Button onClick={save} disabled={busy || value.trim() === saved}>
          {t("save")}
        </Button>
      </CardContent>
    </Card>
  );
}
