import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { getCustomer } from "@/lib/api/customers";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { NewContractForm } from "../../../../contracts/contract-form-pages";
import { loadContractFormData } from "../../../../contracts/form-data";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("create") };
}

/** A new contract for one customer (FR-CON-001): a page, because the form is long (docs/23 §7). */
export default async function NewContractPage({ params }: PageProps<"/customers/[id]/contracts/new">) {
  const user = await requirePageUser();
  if (!can(user, "contract.create")) return <ForbiddenState />;
  const t = await getTranslations("contracts");
  const { id } = await params;
  const customer = await getCustomer(id).catch((error: unknown) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const data = await loadContractFormData(customer.id, customer.branch.id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href={`/customers/${customer.id}`}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
      </Button>
      <PageHeader title={t("create")} description={`${customer.customerCode} · ${customer.fullName}`} />
      <NewContractForm customer={{ id: customer.id }} {...data} />
    </>
  );
}
