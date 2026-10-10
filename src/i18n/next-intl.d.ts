import type messages from "../../messages/vi.json";
import type { Locale } from "@/i18n/config";

// Type-checks every translation key against the Vietnamese catalog.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
