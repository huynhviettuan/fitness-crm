"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CopyIcon, ScrollTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { notify } from "@/components/notify";
import { cn } from "cn";
import { scriptLanguage, type ConsultingScript, type ScriptLanguage } from "@flow/shared/leads";

/**
 * The script panel of a lead (FR-LEAD-010): pick a situation, see the answer in the
 * customer's language, and copy it to paste into the chat. A side panel on a wide
 * screen and a full-width one on a phone.
 */
export function ScriptsPanel({
  scripts,
  nationalityGroup,
}: {
  scripts: ConsultingScript[];
  nationalityGroup: "VIETNAM" | "FOREIGN" | null;
}) {
  const t = useTranslations("leads.scripts");
  const [language, setLanguage] = useState<ScriptLanguage>(scriptLanguage(nationalityGroup));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = scripts.find((script) => script.id === selectedId) ?? null;
  const answer = selected && (language === "vi" ? selected.answerVi : selected.answerEn);

  const copy = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      notify.success(t("copied"));
    } catch {
      notify.error(t("copyFailed"));
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <ScrollTextIcon />
          {t("open")}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {scripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <>
              <div role="group" aria-label={t("language")} className="flex gap-1">
                {(["vi", "en"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={language === value ? "secondary" : "ghost"}
                    aria-pressed={language === value}
                    onClick={() => setLanguage(value)}
                  >
                    {t(value)}
                  </Button>
                ))}
              </div>
              <ul className="flex flex-col gap-1" aria-label={t("title")}>
                {scripts.map((script) => (
                  <li key={script.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={script.id === selectedId}
                      className={cn("w-full justify-start", script.id === selectedId && "bg-muted font-medium")}
                      onClick={() => setSelectedId(script.id)}
                    >
                      {language === "vi" ? script.situationVi : script.situationEn}
                    </Button>
                  </li>
                ))}
              </ul>
              {selected && (
                <section
                  aria-label={language === "vi" ? selected.situationVi : selected.situationEn}
                  className="space-y-3"
                >
                  {answer ? (
                    <>
                      <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-line">{answer}</p>
                      <Button type="button" onClick={copy}>
                        <CopyIcon />
                        {t("copy")}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("noAnswer")}</p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
