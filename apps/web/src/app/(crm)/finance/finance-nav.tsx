import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMonth } from "@/lib/format";

type Tab = "payments" | "debt" | "cash";

/** The Finance screen's tabs (docs/08 Screen 8). Each tab is its own page. */
export function FinanceTabs({ active, showCash }: { active: Tab; showCash: boolean }) {
  const t = useTranslations("finance");
  const tabs: Tab[] = showCash ? ["payments", "debt", "cash"] : ["payments", "debt"];
  return (
    <nav aria-label={t("title")} className="mb-4 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Button key={tab} variant={tab === active ? "secondary" : "ghost"} size="sm" asChild>
          <Link href={`/finance/${tab}`} aria-current={tab === active ? "page" : undefined}>
            {t(`tabs.${tab}`)}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

/** Previous / this / next month, kept in the URL as ?month=yyyy-MM. */
export function MonthNav({ path, month, thisMonth }: { path: string; month: Date; thisMonth: Date }) {
  const t = useTranslations("finance");
  const href = (date: Date) => `${path}?month=${date.toISOString().slice(0, 7)}`;
  const shift = (by: number) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + by, 1));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label={t("previousMonth")} asChild>
        <Link href={href(shift(-1))}>
          <ChevronLeftIcon />
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href={href(thisMonth)}>{t("thisMonth")}</Link>
      </Button>
      <Button variant="outline" size="icon" aria-label={t("nextMonth")} asChild>
        <Link href={href(shift(1))}>
          <ChevronRightIcon />
        </Link>
      </Button>
      <h2 className="ml-2 text-sm font-medium text-muted-foreground">{t("month", { month: formatMonth(month) })}</h2>
    </div>
  );
}
