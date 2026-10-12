"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { COUNTRY_CODES, HOME_COUNTRY, countryName } from "@flow/shared/countries";

/** The countries as options (D-057): Việt Nam first, then the others in the language's order. */
export function useCountryOptions(): { value: string; label: string }[] {
  const locale = useLocale();
  return useMemo(() => {
    const collator = new Intl.Collator(locale);
    const named = COUNTRY_CODES.map((value) => ({ value: value as string, label: countryName(value, locale) }));
    const home = named.filter((entry) => entry.value === HOME_COUNTRY);
    const others = named
      .filter((entry) => entry.value !== HOME_COUNTRY)
      .sort((a, b) => collator.compare(a.label, b.label));
    return [...home, ...others];
  }, [locale]);
}
