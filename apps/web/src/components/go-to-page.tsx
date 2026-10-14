"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAGE_PLACEHOLDER } from "@/lib/paging";

/**
 * Jumps to any page of a long list: type the number and press Enter or Go. A number outside the list is brought back into
 * it. The links are made by the server (`TablePagination`), so every filter in the URL is kept.
 */
export function GoToPage({ pages, firstHref, template }: { pages: number; firstHref: string; template: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = useState("");

  function go(event: React.FormEvent) {
    event.preventDefault();
    const typed = Number.parseInt(value, 10);
    if (!Number.isFinite(typed)) return;
    const target = Math.min(Math.max(typed, 1), pages);
    router.push((target === 1 ? firstHref : template.replace(String(PAGE_PLACEHOLDER), String(target))) as never);
    setValue("");
  }

  return (
    <form onSubmit={go} className="flex items-center gap-1">
      <Input
        type="number"
        inputMode="numeric"
        // No min and max: the browser would refuse a number past the end, and it is brought back into the list instead.
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t("pageNumber")}
        placeholder={t("pageNumber")}
        className="h-8 w-20"
      />
      <Button type="submit" variant="outline" size="sm" disabled={value.trim() === ""}>
        {t("goToButton")}
      </Button>
    </form>
  );
}
