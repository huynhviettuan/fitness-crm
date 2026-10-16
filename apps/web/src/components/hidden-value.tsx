import { useTranslations } from "next-intl";

/** A value the user's role is not allowed to see (D-017), shown as "hidden", never as "not provided". */
export function HiddenValue() {
  const t = useTranslations("common");
  return <span className="text-muted-foreground italic">{t("hidden")}</span>;
}
