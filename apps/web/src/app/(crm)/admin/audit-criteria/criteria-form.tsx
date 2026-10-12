"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/notify";
import type { AuditCriterion } from "@flow/shared/leads";
import { useSubmit } from "../users/user-dialogs";
import { saveAuditCriteriaAction } from "./actions";

/** The criteria of the automatic audit: whether each counts and how much (A-083). */
export function CriteriaForm({ criteria }: { criteria: AuditCriterion[] }) {
  const t = useTranslations("auditCriteria");
  const tAudit = useTranslations("leadAudit.criteria");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const [rows, setRows] = useState(criteria.map((c) => ({ key: c.key, active: c.active, weight: String(c.weight) })));
  const invalid = (weight: string) => !/^\d{1,2}$/.test(weight) || Number(weight) < 1 || Number(weight) > 10;

  const save = () => {
    if (rows.some((row) => invalid(row.weight))) return;
    run(
      () => saveAuditCriteriaAction({ criteria: rows.map((row) => ({ ...row, weight: Number(row.weight) })) }),
      () => {},
      () => {
        notify.success(t("saved"));
        router.refresh();
      },
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="max-w-3xl space-y-6"
      noValidate
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{t("title")}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">{t("criterion")}</th>
            <th className="py-2 pr-4 font-medium">{t("appliesTo")}</th>
            <th className="py-2 pr-4 font-medium">{t("active")}</th>
            <th className="py-2 font-medium">{t("weight")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-b align-top">
              <td className="py-3 pr-4 font-medium">{tAudit(row.key)}</td>
              <td className="py-3 pr-4 text-muted-foreground">{t(`applies.${row.key}`)}</td>
              <td className="py-3 pr-4">
                <Switch
                  aria-label={`${t("active")}: ${tAudit(row.key)}`}
                  checked={row.active}
                  onCheckedChange={(active) =>
                    setRows((all) => all.map((r, i) => (i === index ? { ...r, active } : r)))
                  }
                />
              </td>
              <td className="py-3">
                <Label htmlFor={`weight-${row.key}`} className="sr-only">
                  {`${t("weight")}: ${tAudit(row.key)}`}
                </Label>
                <Input
                  id={`weight-${row.key}`}
                  inputMode="numeric"
                  className="w-24"
                  value={row.weight}
                  aria-invalid={invalid(row.weight)}
                  onChange={(event) =>
                    setRows((all) => all.map((r, i) => (i === index ? { ...r, weight: event.target.value } : r)))
                  }
                />
                {invalid(row.weight) && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {tv("weightOutOfRange")}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="submit" disabled={pending || rows.some((row) => invalid(row.weight))}>
        {pending ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
