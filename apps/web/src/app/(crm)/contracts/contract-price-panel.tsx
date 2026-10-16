"use client";

import { useEffect, useState } from "react";
import { useTimeZone, useTranslations } from "next-intl";
import { useWatch, type Control } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { Money } from "@/components/money";
import { NO_OPTION } from "@/components/option-select";
import { useValidationMessage } from "@/components/form-fields";
import { contractEndDate } from "@gymcrm/shared/contracts";
import { priceBreakdown, type PriceQuote } from "@gymcrm/shared/promotions";
import { calendarDateInTimeZone, parseDateOnly } from "@gymcrm/shared/validation";
import { quotePriceAction } from "../admin/services/actions";
import type { ContractFormValues } from "./contract-form";

type Request = {
  serviceId: string;
  sessions: string;
  asOf?: string;
  promotionId?: string;
  voucherCode?: string;
  vatPercent?: string;
};

type Answer = { key: string; quote: PriceQuote | null; error: string | null };

const WHOLE = /^\d{1,4}$/;

/** What to ask the quote for, or null while the service or the number of sessions is missing (FR-CON-002). */
function requestOf(values: ContractFormValues): Request | null {
  if (!values.serviceId || !WHOLE.test(values.sessions.trim()) || Number(values.sessions) < 1) return null;
  const date = values.contractDate.trim();
  return {
    serviceId: values.serviceId,
    sessions: values.sessions.trim(),
    ...(parseDateOnly(date) ? { asOf: date } : {}),
    // An exception price takes no promotion or voucher (A-113); its VAT is added here.
    ...(values.isException
      ? {}
      : {
          ...(values.promotionId && values.promotionId !== NO_OPTION ? { promotionId: values.promotionId } : {}),
          ...(values.voucherCode.trim() ? { voucherCode: values.voucherCode.trim() } : {}),
          ...(values.vatPercent.trim() ? { vatPercent: values.vatPercent.trim().replace(",", ".") } : {}),
        }),
  };
}

/**
 * The price as the API will work it out (BR-301, FR-CON-002), asked again a moment after the form changes: the tier,
 * the promotion, the voucher, and VAT; or, for an exception price, the agreed price against the tier's. Only the API
 * decides the price; this shows it.
 */
export function ContractPricePanel({ control }: { control: Control<ContractFormValues> }) {
  const t = useTranslations("contracts.panel");
  const validationMessage = useValidationMessage();
  const timeZone = useTimeZone();
  const values = useWatch({ control }) as ContractFormValues;
  const request = requestOf(values);
  const key = request ? JSON.stringify(request) : "";
  const [answer, setAnswer] = useState<Answer>({ key: "", quote: null, error: null });

  useEffect(() => {
    if (!key) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await quotePriceAction(
        (JSON.parse(key) as Request).serviceId,
        JSON.parse(key) as Omit<Request, "serviceId">,
      );
      if (!current) return;
      setAnswer(
        result.ok
          ? { key, quote: result.data, error: null }
          : { key, quote: null, error: Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "invalidNumber" },
      );
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (!request)
    return <Shell title={t("title")}>{<p className="text-sm text-muted-foreground">{t("empty")}</p>}</Shell>;
  if (answer.key !== key) {
    return (
      <Shell title={t("title")}>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("calculating")}
        </p>
      </Shell>
    );
  }
  if (!answer.quote) {
    return (
      <Shell title={t("title")}>
        <p role="alert" className="text-sm text-destructive">
          {validationMessage(answer.error ?? "invalidNumber")}
        </p>
      </Shell>
    );
  }

  const quote = answer.quote;
  const sessions = quote.sessions;
  const proposed = Number(values.proposedUnitPrice.replace(/[.,\s]/g, ""));
  const exception = values.isException && Number.isFinite(proposed) && proposed > 0 && proposed !== quote.unitPrice;
  const breakdown = exception
    ? priceBreakdown({
        unitPrice: proposed,
        sessions,
        vatPercent: Number(values.vatPercent.replace(",", ".")) || 0,
      })
    : quote.breakdown;
  const tierTotal = quote.unitPrice * sessions;
  const percent = tierTotal > 0 ? Math.round((Math.max(0, tierTotal - breakdown.net) / tierTotal) * 10_000) / 100 : 0;

  const today = calendarDateInTimeZone(timeZone ?? "Asia/Ho_Chi_Minh");
  const start = parseDateOnly(values.startDate) ?? parseDateOnly(values.contractDate) ?? today;
  const bonusMonths = Number(values.bonusMonths) || 0;
  const bonusDays = Number(values.bonusDays) || 0;
  const end = contractEndDate(
    start,
    { months: quote.validityMonths, days: quote.validityDays },
    { months: bonusMonths, days: bonusDays },
  );

  return (
    <Shell title={t("title")}>
      <dl className="space-y-3 text-sm" aria-live="polite">
        <Row label={t("displayName")}>{quote.displayName}</Row>
        <Row label={t("tierPrice")}>
          <Money amount={quote.unitPrice} />
        </Row>
        {exception && (
          <>
            <Row label={t("unitPrice")}>
              <Money amount={proposed} />
            </Row>
            <Row label={t("exceptionDiff")}>
              <Money amount={proposed * sessions - tierTotal} />
            </Row>
          </>
        )}
        <Row label={t("gross")}>
          <Money amount={exception ? breakdown.gross : tierTotal} />
        </Row>
        {breakdown.promotionDiscount > 0 && (
          <Row label={t("promotionDiscount")}>
            −<Money amount={breakdown.promotionDiscount} />
          </Row>
        )}
        {breakdown.voucherDiscount > 0 && (
          <Row label={t("voucherDiscount")}>
            −<Money amount={breakdown.voucherDiscount} />
          </Row>
        )}
        {(breakdown.totalDiscount > 0 || exception) && (
          <Row label={t("net")}>
            <Money amount={breakdown.net} />
            {percent > 0 && <span className="ml-2 text-muted-foreground">{t("discountPercent", { percent })}</span>}
          </Row>
        )}
        {breakdown.vatAmount > 0 && (
          <Row label={t("vat", { percent: breakdown.vatPercent })}>
            <Money amount={breakdown.vatAmount} />
          </Row>
        )}
        <Row label={t("total")} strong>
          <Money amount={breakdown.total} />
        </Row>
        <Row label={t("endDate")}>
          <DateTime value={end} format="dateOnly" />
        </Row>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("validity", { months: quote.validityMonths, days: quote.validityDays })}
      </p>
      {exception && <p className="mt-2 text-sm font-medium text-warning">{t("exceptionFlag")}</p>}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card role="region" aria-label={title} className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-base font-semibold" : "font-medium"}>{children}</dd>
    </div>
  );
}
