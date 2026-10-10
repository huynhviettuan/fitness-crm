import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { localeFromAcceptLanguage, type Locale } from "@/i18n/config";

// No locale in the URL (T-027): a signed-in user's saved language wins, otherwise
// the browser's language, otherwise Vietnamese.
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    timeZone: env.GYM_TIMEZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

async function resolveLocale(): Promise<Locale> {
  const user = await getCurrentUser();
  if (user) return user.locale;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}
