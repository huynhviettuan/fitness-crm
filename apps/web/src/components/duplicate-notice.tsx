"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DuplicatePerson } from "@flow/shared/errors";

/**
 * D-019: a phone belongs to one person. When the API refuses a second record, this
 * names the existing one so the user opens it instead (the merge arrives in M2 slice 5).
 */
export function DuplicateNotice({ duplicate }: { duplicate: DuplicatePerson | null }) {
  const t = useTranslations("people");
  if (!duplicate) return null;
  const href = duplicate.stage === "LEAD" ? `/leads/${duplicate.id}` : `/customers/${duplicate.id}`;
  return (
    <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      {t(duplicate.stage === "LEAD" ? "duplicateLead" : "duplicateCustomer", { code: duplicate.code, name: duplicate.fullName })}{" "}
      <Link href={href} className="font-medium underline underline-offset-4">
        {t("openExisting", { code: duplicate.code })}
      </Link>
    </div>
  );
}
