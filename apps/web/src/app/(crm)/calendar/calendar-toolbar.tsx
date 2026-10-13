"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MIN_CUSTOMER_QUERY_LENGTH, useCustomerSearch } from "@/components/use-customer-search";
import { parseDateOnly } from "@flow/shared/validation";
import type { TrainerOption } from "../bookings/booking-types";
import type { CalendarFilters, CalendarView } from "./calendar-types";

const ALL = "all";

type CalendarToolbarProps = {
  filters: CalendarFilters;
  /** Today, yyyy-MM-dd (the URL format). */
  today: string;
  trainers: TrainerOption[];
  /** The branches the user works in; the filter shows when there are several. */
  branches: { id: string; name: string }[];
};

type FilterChange = Partial<Omit<CalendarFilters, "customer">> & { customer?: CalendarFilters["customer"] | null };

/** Date, day or week view, and the branch, trainer, and customer filters (FR-PT-001). Everything lives in the URL. */
export function CalendarToolbar({ filters, today, trainers, branches }: CalendarToolbarProps) {
  const t = useTranslations("bookings");
  const router = useRouter();
  const [goTo, setGoTo] = useState("");
  const step = filters.view === "week" ? 7 : 1;

  const hrefFor = (change: FilterChange) => {
    const next = { ...filters, ...change };
    const query = new URLSearchParams({ date: next.day });
    if (next.view === "week") query.set("view", "week");
    if (next.trainerId) query.set("trainer", next.trainerId);
    if (next.branchId) query.set("branch", next.branchId);
    if (next.customer) query.set("customer", next.customer.id);
    return `/calendar?${query}`;
  };
  const viewLink = (view: CalendarView) => (
    <Button variant={filters.view === view ? "secondary" : "outline"} asChild>
      <Link href={hrefFor({ view })} aria-current={filters.view === view ? "page" : undefined}>
        {t(`calendarViews.${view}`)}
      </Link>
    </Button>
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label={t(filters.view === "week" ? "previousWeek" : "previousDay")}
        asChild
      >
        <Link href={hrefFor({ day: shiftDay(filters.day, -step) })}>
          <ChevronLeftIcon />
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href={hrefFor({ day: today })} aria-current={filters.day === today ? "date" : undefined}>
          {t("today")}
        </Link>
      </Button>
      <Button variant="outline" size="icon" aria-label={t(filters.view === "week" ? "nextWeek" : "nextDay")} asChild>
        <Link href={hrefFor({ day: shiftDay(filters.day, step) })}>
          <ChevronRightIcon />
        </Link>
      </Button>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const date = parseDateOnly(goTo);
          if (date) router.push(hrefFor({ day: date.toISOString().slice(0, 10) }));
        }}
      >
        <Input
          value={goTo}
          onChange={(event) => setGoTo(event.target.value)}
          placeholder={t("datePlaceholder")}
          aria-label={t("goToDate")}
          inputMode="numeric"
          className="w-32"
        />
        <Button type="submit" variant="outline">
          {t("goToDate")}
        </Button>
      </form>
      <div role="toolbar" aria-label={t("calendarView")} className="flex gap-1">
        {viewLink("day")}
        {viewLink("week")}
      </div>
      {branches.length > 1 && (
        <Select
          value={filters.branchId ?? ALL}
          onValueChange={(value) =>
            router.push(hrefFor({ branchId: value === ALL ? undefined : value, trainerId: undefined }))
          }
        >
          <SelectTrigger aria-label={t("fields.branch")} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allBranches")}</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {trainers.length > 1 && (
        <Select
          value={filters.trainerId ?? ALL}
          onValueChange={(value) => router.push(hrefFor({ trainerId: value === ALL ? undefined : value }))}
        >
          <SelectTrigger aria-label={t("fields.trainer")} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allTrainers")}</SelectItem>
            {trainers.map((trainer) => (
              <SelectItem key={trainer.id} value={trainer.id}>
                {trainer.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <CustomerFilter customer={filters.customer} onChange={(customer) => router.push(hrefFor({ customer }))} />
    </div>
  );
}

/** Narrows the grid to one customer: search by code, name, or phone, then pick. */
function CustomerFilter({
  customer,
  onChange,
}: {
  customer?: { id: string; fullName: string };
  onChange: (customer: { id: string; fullName: string } | null) => void;
}) {
  const t = useTranslations("bookings");
  const [query, setQuery] = useState("");
  const results = useCustomerSearch(query, 6);

  if (customer) {
    return (
      <div className="flex items-center gap-1 rounded-lg border py-1 pr-1 pl-3 text-sm">
        <span className="truncate">{t("customerFilter", { name: customer.fullName })}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("clearCustomer")}
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("customerFilterPlaceholder")}
        aria-label={t("customerFilterLabel")}
        className="w-56"
      />
      {query.trim().length >= MIN_CUSTOMER_QUERY_LENGTH && results.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 w-72 rounded-lg border bg-popover p-1 shadow-md">
          {results.map((result) => (
            <li key={result.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setQuery("");
                  onChange({ id: result.id, fullName: result.fullName });
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">{result.customerCode}</span> {result.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
