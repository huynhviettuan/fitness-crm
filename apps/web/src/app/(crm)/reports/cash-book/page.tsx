import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listOptions } from "@/lib/api/configuration";
import { getCashBook } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../report-filters";
import { CashBookView } from "./cash-book-view";
import { OpeningBalanceButton } from "./opening-dialog";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cashBook");
  return { title: t("title") };
}

/** The cash book (brief §8.1, FR-CASH-005, AC-19): opening, in, out, and closing per branch and method, and per day. */
export default async function CashBookPage({ searchParams }: PageProps<"/reports/cash-book">) {
  const user = await requirePageUser();
  if (!can(user, "report.cashBook")) return <ForbiddenState />;

  const t = await getTranslations("cashBook");
  const locale = await getLocale();
  const values = readPeriodParams(await searchParams, user.branches);
  const canSetOpening = can(user, "cash.opening");
  const [book, methods] = await Promise.all([
    getCashBook(values),
    // "Khác" has no cash of its own: the opening balance is set per named method.
    canSetOpening ? listOptions("paymentMethods") : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {canSetOpening && (
              <OpeningBalanceButton
                branches={user.branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                methods={methods
                  .filter((method) => !method.isOther)
                  .map((method) => ({ value: method.id, label: locale === "vi" ? method.labelVi : method.labelEn }))}
              />
            )}
            {can(user, "report.cashBookExport") && (
              <ExportButton path="/api/v1/reports/cash-book/export" query={values} />
            )}
          </>
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/reports/cash-book" values={values} branches={user.branches} />
        <CashBookView book={book} />
      </div>
    </>
  );
}
