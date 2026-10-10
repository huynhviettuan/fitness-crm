import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon, CalendarIcon, FileTextIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { DateTime } from "@/components/date-time";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isAppError } from "@/lib/errors/app-error";
import { can } from "@flow/shared/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { getCustomer } from "@/modules/customers/customer.service";
import { listContracts } from "@/modules/contracts/contract.service";
import { listBookings } from "@/modules/bookings/booking.service";
import { listPayments } from "@/modules/finance/payment.service";
import { bookingContext } from "../../bookings/booking-context";
import { AddBookingButton, BookingsTable } from "../../bookings/bookings-table";
import { CreateContractButton } from "../../contracts/contract-buttons";
import { PaymentsTable } from "../../finance/payments";
import { ContractsTable } from "../../contracts/contracts-table";
import { EditCustomerButton } from "../customer-sheets";

async function loadCustomer(user: CurrentUser, id: string) {
  try {
    return await getCustomer(user, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  const customer = await loadCustomer(user, (await params).id);
  return { title: `${customer.customerCode} · ${customer.fullName}` };
}

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const user = await requirePageUser();
  const customer = await loadCustomer(user, (await params).id);
  const t = await getTranslations("customers");
  const tc = await getTranslations("contracts");
  const canSeeContracts = can(user.role, "contract.view");
  const contracts = canSeeContracts ? await listContracts(user, { customerId: customer.id, pageSize: 100 }) : null;
  const canSeeBookings = can(user.role, "booking.view");
  const [bookings, context, tb] = canSeeBookings
    ? await Promise.all([
        listBookings(user, { customerId: customer.id, order: "desc", pageSize: 100 }),
        bookingContext(user),
        getTranslations("bookings"),
      ])
    : [null, null, null];
  const payments = can(user.role, "payment.view") ? await listPayments(user, { customerId: customer.id, pageSize: 100 }) : null;

  const details: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.customerCode"), value: <span className="font-mono">{customer.customerCode}</span> },
    { label: t("fields.phone"), value: customer.phone },
    { label: t("fields.email"), value: customer.email },
    {
      label: t("fields.dateOfBirth"),
      value: customer.dateOfBirth && <DateTime value={customer.dateOfBirth} format="dateOnly" />,
    },
    { label: t("fields.status"), value: <StatusBadge entity="customer" status={customer.status} /> },
    { label: t("fields.createdAt"), value: <DateTime value={customer.createdAt} format="dateTime" /> },
    { label: t("fields.notes"), value: customer.notes && <span className="whitespace-pre-line">{customer.notes}</span> },
  ];

  return (
    <>
      <PageHeader
        title={customer.fullName}
        description={`${customer.customerCode} · ${customer.phone}`}
        actions={can(user.role, "customer.manage") && <EditCustomerButton customer={customer} />}
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          {canSeeContracts && <TabsTrigger value="contracts">{t("tabs.contracts")}</TabsTrigger>}
          {canSeeBookings && <TabsTrigger value="bookings">{t("tabs.bookings")}</TabsTrigger>}
          {payments && <TabsTrigger value="payments">{t("tabs.payments")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>
                <h2>{t("details")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {details.map(({ label, value }) => (
                  <div key={label} className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-sm">{value || <NotProvided />}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
        {contracts && (
          <TabsContent value="contracts" className="space-y-4">
            {can(user.role, "contract.manage") && (
              <div className="flex justify-end">
                <CreateContractButton customerId={customer.id} />
              </div>
            )}
            <ContractsTable
              contracts={contracts.items}
              showCustomer={false}
              empty={<EmptyState icon={FileTextIcon} title={tc("customerEmptyTitle")} />}
            />
          </TabsContent>
        )}
        {bookings && context && tb && (
          <TabsContent value="bookings" className="space-y-4">
            {context.permissions.manage && context.trainers.length > 0 && (
              <div className="flex justify-end">
                <AddBookingButton
                  trainers={context.trainers}
                  preset={{ customer: { id: customer.id, label: `${customer.customerCode} · ${customer.fullName}` } }}
                />
              </div>
            )}
            <BookingsTable
              bookings={bookings.items}
              permissions={context.permissions}
              trainers={context.trainers}
              label={t("tabs.bookings")}
              hide={{ customer: true }}
              empty={<EmptyState icon={CalendarIcon} title={tb("customerEmptyTitle")} />}
            />
          </TabsContent>
        )}
        {payments && (
          <TabsContent value="payments">
            <PaymentsTable
              payments={payments.items}
              canVoid={can(user.role, "payment.void")}
              label={t("tabs.payments")}
              hide={{ customer: true }}
              empty={<EmptyState icon={BanknoteIcon} title={tc("paymentHistoryEmpty")} />}
            />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

async function NotProvided() {
  const t = await getTranslations("common");
  return <span className="text-muted-foreground">{t("notProvided")}</span>;
}
