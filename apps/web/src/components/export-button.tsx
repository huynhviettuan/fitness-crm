"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import { apiErrorSchema } from "@flow/shared/errors";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";

type ExportButtonProps = {
  /** The list's export endpoint, e.g. "/api/v1/customers/export" (A-077 to A-080). */
  path: string;
  /** The list's own search and filters as the API takes them; the export holds every row, not the page. */
  query: Record<string, string | number | boolean | undefined>;
};

/**
 * "Export Excel" of the shared list template (brief §1): downloads the list as the user
 * sees it. The browser asks the web app's `/api/*` (T-053); a refusal, such as a list longer
 * than the export limit, is shown as a message, not as a page of JSON.
 */
export function ExportButton({ path, query }: ExportButtonProps) {
  const t = useTranslations("common");
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);

  const download = async () => {
    setPending(true);
    try {
      const search = new URLSearchParams(
        Object.entries(query).flatMap(([key, value]) =>
          value === undefined || value === "" || value === false ? [] : [[key, String(value)]],
        ),
      ).toString();
      const response = await fetch(search ? `${path}?${search}` : path);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
        if (parsed.success && parsed.data.details.exportLimit) {
          return void notify.error(t("exportTooLarge", parsed.data.details.exportLimit));
        }
        return void notify.error(errorMessage(parsed.success ? parsed.data.code : "INTERNAL_ERROR"));
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "export.xlsx";
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      notify.error(errorMessage("INTERNAL_ERROR"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Button variant="outline" onClick={download} disabled={pending}>
      <DownloadIcon />
      {pending ? t("exporting") : t("exportExcel")}
    </Button>
  );
}
