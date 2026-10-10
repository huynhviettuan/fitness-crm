"use client";

import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

/** ErrorState for unexpected failures while rendering a CRM page. */
export default function CrmError({ retry }: { retry: () => void }) {
  const t = useTranslations();
  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title={t("errorPage.title")}
      description={t("errors.INTERNAL_ERROR")}
      action={
        <Button variant="outline" onClick={() => retry()}>
          {t("errorPage.retry")}
        </Button>
      }
    />
  );
}
