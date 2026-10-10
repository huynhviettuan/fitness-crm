import { useTranslations } from "next-intl";
import { ShieldXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/** Shown when a signed-in user opens a page their role cannot use. */
export function ForbiddenState() {
  const t = useTranslations("forbidden");
  return <EmptyState icon={ShieldXIcon} title={t("title")} description={t("body")} />;
}
