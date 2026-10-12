import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { NO_OPTION } from "@/components/option-select";
import { isApiError } from "@/lib/api/errors";
import { getContract } from "@/lib/api/contracts";
import { getCustomer } from "@/lib/api/customers";
import { requirePageUser } from "@/lib/auth/current-user";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isEditable, type Contract } from "@flow/shared/contracts";
import type { ContractFormValues } from "../../contract-form";
import { EditContractForm } from "../../contract-form-pages";
import { loadContractFormData } from "../../form-data";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("edit") };
}

const day = (date: Date | null) => (date ? formatDateOnly(date) : "");

/** The form's text for a contract already made, to change while it is a draft (OQ-015 interim). */
function valuesOf(contract: Contract): ContractFormValues {
  const shares = (role: "PT" | "SALE") =>
    contract.shares
      .filter((share) => share.role === role)
      .map((share) => ({ employeeId: share.employee.id, percent: String(share.percent) }));
  return {
    serviceId: contract.service?.id ?? "",
    sessions: String(contract.sessionsBought),
    contractType: contract.contractType,
    previousContractId: contract.previousContract?.id ?? NO_OPTION,
    contractDate: day(contract.contractDate),
    startDate: day(contract.startDate),
    activationDeadline: day(contract.activationDeadline),
    bonusSessions: String(contract.bonusSessions),
    bonusMonths: String(contract.bonusMonths),
    bonusDays: String(contract.bonusDays),
    promotionId: contract.promotion?.id ?? NO_OPTION,
    // A voucher's code is never shown to staff (A-110): it is typed again to keep the voucher.
    voucherCode: "",
    vatPercent: String(contract.vatPercent),
    isException: contract.isExceptionPrice,
    proposedUnitPrice: contract.isExceptionPrice ? String(contract.approvedUnitPrice) : "",
    exceptionReasonId: contract.exceptionReason?.id ?? "",
    exceptionNote: contract.exceptionNote ?? "",
    ptShares: shares("PT"),
    saleShares: shares("SALE"),
    signed: contract.signed,
    signedOn: day(contract.signedOn),
    signedBy: contract.signedBy ?? "",
    signatureNote: contract.signatureNote ?? "",
    firstAmount: "",
    firstMethodId: "",
    firstMethodNote: "",
    paymentDueOn: day(contract.paymentDueOn),
    notes: contract.notes ?? "",
  };
}

export default async function EditContractPage({ params }: PageProps<"/contracts/[id]/edit">) {
  const user = await requirePageUser();
  if (!can(user, "contract.create")) return <ForbiddenState />;
  const t = await getTranslations("contracts");
  const { id } = await params;
  const contract = await getContract(id).catch((error: unknown) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (!isEditable(contract.status)) notFound();
  const customer = await getCustomer(contract.customer.id);
  const data = await loadContractFormData(customer.id, customer.branch.id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href={`/contracts/${contract.id}`}>
          <ArrowLeftIcon />
          {contract.contractCode}
        </Link>
      </Button>
      <PageHeader title={t("edit")} description={`${contract.contractCode} · ${contract.customer.fullName}`} />
      <EditContractForm
        contractId={contract.id}
        customer={{ id: customer.id }}
        {...data}
        voucherName={contract.voucher?.name ?? null}
        defaultValues={valuesOf(contract)}
        defaultCompanions={contract.companions.map((c) => ({ id: c.id, label: `${c.customerCode} · ${c.fullName}` }))}
      />
    </>
  );
}
