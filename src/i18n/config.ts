// T-027, A-011
export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "vi";

/** Picks the UI language from an Accept-Language header (first preference only). */
export function localeFromAcceptLanguage(header: string | null): Locale {
  const first = header?.split(",")[0]?.trim().toLowerCase() ?? "";
  const language = first.split(/[-;]/)[0];
  return (LOCALES as readonly string[]).includes(language) ? (language as Locale) : DEFAULT_LOCALE;
}
