import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestionIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main className="mx-auto max-w-xl p-6">
      <EmptyState
        icon={FileQuestionIcon}
        title={t("title")}
        description={t("body")}
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard">{t("back")}</Link>
          </Button>
        }
      />
    </main>
  );
}
