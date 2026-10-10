import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon, CalendarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import type { CurrentUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors/app-error";
import { can } from "@/lib/permissions";
import { canActivate, canCancel, isEditable } from "@/modules/contracts/contract.domain";
import { getContract } from "@/modules/contracts/contract.service";
import { listBookings } from "@/modules/bookings/booking.service";
import { listPayments } from "@/modules/finance/payment.service";
import { bookingContext } from "../../bookings/booking-context";
import { AddBookingButton, BookingsTable } from "../../bookings/bookings-table";
import { PaymentsTable, RecordPaymentButton } from "../../finance/payments";
import { ActivateContractButton, CancelContractButton, EditContractButton } from "../contract-buttons";

async function loadContract(user: CurrentUser, id: string) {
  try {
    return await getContract(user, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/contracts/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  const contract = await loadContract(user, (await params).id);
  return { title: `${contract.contractCode} · ${contract.packageName}` };
}

export default async function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  const user = await requirePageUser();
  const contract = await loadContract(user, (await params).id);
  const t = await getTranslations("contracts");
  const f = (key: Parameters<typeof t>[0]) => t(key);

  const canSeeBookings = can(user.role, "booking.view");
  const [history, context] = canSeeBookings
    ? await Promise.all([listBookings(user, { contractId: contract.id, order: "desc", pageSize: 100 }), bookingContext(user)])
    : [null, null];
  const payments = can(user.role, "payment.view")
    ? await listPayments(user, { contractId: contract.id, pageSize: 100 })
    : null;
  // OQ-003 and OQ-013 interim: nothing more to collect once paid in full, or once cancelled.
  const canRecordPayment = can(user.role, "payment.record") && contract.status !== "CANCELLED" && contract.debt > 0;
  const cancellable = can(user.role, "contract.cancel") && canCancel(contract.status);
  // D-010: the cancel confirmation lists the bookings it will cancel.
  const toCancel = cancellable
    ? (await listBookings(user, { contractId: contract.id, status: "BOOKED", pageSize: 100 })).items
    : [];

  const manage = can(user.role, "contract.manage");
  const actions = (
    <>
      {manage && isEditable(contract.status) && <EditContractButton contract={contract} />}
      {cancellable && <CancelContractButton contract={contract} bookings={toCancel} />}
      {manage && canActivate(contract.status) && <ActivateContractButton contract={contract} />}
    </>
  );

  const sessions = [
    { label: f("fields.totalSessions"), value: contract.totalSessions },
    ...(contract.openingSessionsUsed > 0 ? [{ label: f("fields.openingSessionsUsed"), value: contract.openingSessionsUsed }] : []),
    { label: f("fields.completedSessions"), value: contract.completedSessions },
    { label: f("fields.remainingSessions"), value: contract.remainingSessions, strong: true },
  ];
  const money = [
    { label: f("fields.contractValue"), value: <Money amount={contract.contractValue} /> },
    ...(contract.openingPaidAmount > 0
      ? [{ label: f("fields.openingPaidAmount"), value: <Money amount={contract.openingPaidAmount} /> }]
      : []),
    { label: f("fields.paidAmount"), value: <Money amount={contract.paidAmount} /> },
    { label: f("fields.debt"), value: <Money amount={contract.debt} />, strong: true },
  ];

  return (
    <>
      <PageHeader
        title={contract.packageName}
        description={`${contract.contractCode} · ${contract.customer.fullName}`}
        actions={actions}
      />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-3">
        <FigureCard title={t("sessions")} rows={sessions} />
        <FigureCard title={t("money")} rows={money} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("details")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Detail label={f("fields.status")} value={<StatusBadge entity="contract" status={contract.status} />} />
              <Detail
                label={f("fields.customer")}
                value={
                  <Link href={`/customers/${contract.customer.id}`} className="hover:underline">
                    {contract.customer.customerCode} · {contract.customer.fullName}
                  </Link>
                }
              />
              <Detail label={f("fields.startDate")} value={<DateTime value={contract.startDate} format="dateOnly" />} />
              <Detail label={f("fields.endDate")} value={<DateTime value={contract.endDate} format="dateOnly" />} />
              <Detail label={f("fields.createdAt")} value={<DateTime value={contract.createdAt} format="dateTime" />} />
            </dl>
          </CardContent>
        </Card>
      </div>
      {payments && (
        <section aria-labelledby="payment-history" className="mt-8 max-w-5xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="payment-history" className="text-lg font-semibold">
              {t("paymentHistory")}
            </h2>
            {canRecordPayment && <RecordPaymentButton contract={contract} />}
          </div>
          <PaymentsTable
            payments={payments.items}
            canVoid={can(user.role, "payment.void")}
            label={t("paymentHistory")}
            hide={{ contract: true, customer: true }}
            empty={<EmptyState icon={BanknoteIcon} title={t("paymentHistoryEmpty")} />}
          />
        </section>
      )}
      {history && context && (
        <section aria-labelledby="session-history" className="mt-8 max-w-5xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="session-history" className="text-lg font-semibold">
              {t("sessionHistory")}
            </h2>
            {context.permissions.manage && contract.status === "ACTIVE" && context.trainers.length > 0 && (
              <AddBookingButton
                trainers={context.trainers}
                preset={{
                  customer: { id: contract.customer.id, label: `${contract.customer.customerCode} · ${contract.customer.fullName}` },
                  contract: { id: contract.id, label: `${contract.contractCode} · ${contract.packageName}` },
                }}
              />
            )}
          </div>
          <BookingsTable
            bookings={history.items}
            permissions={context.permissions}
            trainers={context.trainers}
            label={t("sessionHistory")}
            hide={{ customer: true, contract: true }}
            empty={<EmptyState icon={CalendarIcon} title={t("sessionHistoryEmpty")} />}
          />
        </section>
      )}
    </>
  );
}

function FigureCard({ title, rows }: { title: string; rows: { label: string; value: React.ReactNode; strong?: boolean }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          {rows.map(({ label, value, strong }) => (
            <Detail key={label} label={label} value={<span className={strong ? "text-base font-semibold tabular-nums" : "tabular-nums"}>{value}</span>} />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}
