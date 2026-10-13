import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { isApiError } from "@/lib/api/errors";
import { getContract } from "@/lib/api/contracts";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { PrintNowButton } from "../../print-button";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("print") };
}

/** The contract as a sheet to print (brief §5.3): the sidebar and header are hidden when printing. */
export default async function ContractPrintPage({ params }: PageProps<"/contracts/[id]/print">) {
  const user = await requirePageUser();
  if (!can(user, "contract.view") || !can(user, "contract.print")) return <ForbiddenState />;
  const t = await getTranslations("contracts");
  const f = (key: Parameters<typeof t>[0]) => t(key);
  const contract = await getContract((await params).id).catch((error: unknown) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: f("fields.customer"),
      value: `${contract.customer.customerCode} · ${contract.customer.fullName}${contract.customerPhone ? ` · ${contract.customerPhone}` : ""}`,
    },
    { label: f("fields.branch"), value: contract.branch.name },
    { label: f("fields.service"), value: contract.service?.name ?? f("fields.imported") },
    { label: f("fields.contractType"), value: t(`types.${contract.contractType}`) },
    { label: f("fields.contractDate"), value: <DateTime value={contract.contractDate} format="dateOnly" /> },
    { label: f("fields.startDate"), value: <DateTime value={contract.startDate} format="dateOnly" /> },
    { label: f("fields.endDate"), value: <DateTime value={contract.endDate} format="dateOnly" /> },
    { label: f("fields.sessionsBought"), value: contract.sessionsBought },
    ...(contract.bonusSessions + contract.bonusMonths + contract.bonusDays > 0
      ? [
          {
            label: f("fields.bonus"),
            value: t("bonusLine", {
              sessions: contract.bonusSessions,
              months: contract.bonusMonths,
              days: contract.bonusDays,
            }),
          },
        ]
      : []),
    { label: f("fields.approvedUnitPrice"), value: <Money amount={contract.approvedUnitPrice} /> },
    ...(contract.promotionDiscount + contract.voucherDiscount > 0
      ? [
          {
            label: f("fields.discount"),
            value: <Money amount={contract.promotionDiscount + contract.voucherDiscount} />,
          },
        ]
      : []),
    ...(contract.vatAmount > 0
      ? [{ label: `${f("fields.vat")} ${contract.vatPercent}%`, value: <Money amount={contract.vatAmount} /> }]
      : []),
    { label: f("fields.contractValue"), value: <Money amount={contract.contractValue} /> },
    { label: f("fields.paidAmount"), value: <Money amount={contract.paidAmount} /> },
    { label: f("fields.debt"), value: <Money amount={contract.debt} /> },
    ...(["PT", "SALE"] as const).flatMap((role) => {
      const shares = contract.shares.filter((share) => share.role === role);
      return shares.length > 0
        ? [
            {
              label: t(`roles.${role}`),
              value: shares.map((share) => `${share.employee.fullName} ${share.percent}%`).join(", "),
            },
          ]
        : [];
    }),
    ...(contract.notes ? [{ label: f("fields.notes"), value: contract.notes }] : []),
  ];

  return (
    <article className="mx-auto max-w-3xl">
      <PageHeader
        title={`${contract.contractCode} · ${contract.packageName}`}
        description={t("printTitle")}
        actions={<PrintNowButton />}
      />
      <dl className="divide-y rounded-lg border">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-6 px-4 py-2">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-right text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-16 grid grid-cols-2 gap-12 text-center text-sm">
        <p>{t("printCustomerSign")}</p>
        <p>{t("printStaffSign")}</p>
      </div>
    </article>
  );
}
