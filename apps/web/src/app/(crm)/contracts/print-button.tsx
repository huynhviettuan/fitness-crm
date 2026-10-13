"use client";

import { useTranslations } from "next-intl";
import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog for the print view. */
export function PrintNowButton() {
  const t = useTranslations("contracts");
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <PrinterIcon />
      {t("printNow")}
    </Button>
  );
}
