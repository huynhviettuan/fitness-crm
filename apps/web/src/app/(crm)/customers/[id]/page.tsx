import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon, CalendarIcon, FileTextIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { getTaskAssignees } from "@/lib/api/tasks";
import { CreateTaskButton } from "../../tasks/task-form";
import { HiddenValue } from "@/components/hidden-value";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getCustomer } from "@/lib/api/customers";
import { getIntakeHistory } from "@/lib/api/leads";
import { listContracts } from "@/lib/api/contracts";
import { listBookings } from "@/lib/api/bookings";
import { listPayments } from "@/lib/api/finance";
import { bookingContext } from "../../bookings/booking-context";
import { AddBookingButton, BookingsTable } from "../../bookings/bookings-table";
import { CreateContractButton } from "../../contracts/contract-buttons";
import { PaymentsTable } from "../../finance/payments";
import { ContractsTable } from "../../contracts/contracts-table";
import { EditCustomerButton } from "../customer-sheets";
import { LeadTimeline } from "../../leads/lead-timeline";
import { MergePersonButton } from "../../leads/merge-person";

async function loadCustomer(user: CurrentUser, id: string) {
  try {
    return await getCustomer(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "customer.view")) return {};
  const customer = await loadCustomer(user, (await params).id);
  return { title: `${customer.customerCode} · ${customer.fullName}` };
}

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "customer.view")) return <ForbiddenState />;
  const customer = await loadCustomer(user, (await params).id);
  const t = await getTranslations("customers");
  const tVisit = await getTranslations("visit");
  const tc = await getTranslations("contracts");
  const canSeeContracts = can(user, "contract.view");
  const contracts = canSeeContracts ? await listContracts({ customerId: customer.id, pageSize: 100 }) : null;
  const canSeeBookings = can(user, "booking.view");
  const [bookings, context, tb] = canSeeBookings
    ? await Promise.all([
        listBookings({ customerId: customer.id, order: "desc", pageSize: 100 }),
        bookingContext(user),
        getTranslations("bookings"),
      ])
    : [null, null, null];
  const payments = can(user, "payment.view") ? await listPayments({ customerId: customer.id, pageSize: 100 }) : null;

  const details: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.customerCode"), value: <span className="font-mono">{customer.customerCode}</span> },
    { label: t("fields.branch"), value: customer.branch.name },
    { label: t("fields.phone"), value: customer.maskedFields.includes("phone") ? <HiddenValue /> : customer.phone },
    { label: t("fields.email"), value: customer.maskedFields.includes("email") ? <HiddenValue /> : customer.email },
    {
      label: t("fields.dateOfBirth"),
      value: customer.dateOfBirth && <DateTime value={customer.dateOfBirth} format="dateOnly" />,
    },
    { label: t("fields.nationality"), value: customer.nationality },
    // D-042: hidden from roles that may not see them; only the type shows then.
    {
      label: t("fields.idDocument"),
      value:
        customer.idDocumentType &&
        (customer.maskedFields.includes("idDocument") ? (
          <>
            {tVisit(`idDocumentTypes.${customer.idDocumentType}`)} · <HiddenValue />
          </>
        ) : (
          <span className="font-mono">
            {tVisit(`idDocumentTypes.${customer.idDocumentType}`)} {customer.idDocumentNumber}
          </span>
        )),
    },
    {
      label: t("fields.healthNote"),
      value: customer.maskedFields.includes("health") ? (
        <HiddenValue />
      ) : (
        customer.healthNote && <span className="whitespace-pre-line">{customer.healthNote}</span>
      ),
    },
    {
      label: t("fields.dataConsentAt"),
      value: customer.dataConsentAt && <DateTime value={customer.dataConsentAt} format="dateTime" />,
    },
    { label: t("fields.status"), value: <StatusBadge entity="customer" status={customer.status} /> },
    { label: t("fields.createdAt"), value: <DateTime value={customer.createdAt} format="dateTime" /> },
    {
      label: t("fields.notes"),
      value: customer.notes && <span className="whitespace-pre-line">{customer.notes}</span>,
    },
  ];

  // BR-202: when the person wrote again or a duplicate record was merged into this one.
  const intake = can(user, "lead.view") ? (await getIntakeHistory(customer.id)).items : [];

  // Brief §8.2: a task about this customer.
  const assignees = can(user, "task.create") ? await getTaskAssignees() : null;

  return (
    <>
      <PageHeader
        title={customer.fullName}
        description={[customer.customerCode, customer.phone].filter(Boolean).join(" · ")}
        actions={
          <>
            {assignees && (
              <CreateTaskButton
                assignees={assignees}
                branches={[]}
                about={{ type: "customer", id: customer.id, label: `${customer.customerCode} · ${customer.fullName}` }}
              />
            )}
            {can(user, "lead.merge") && (
              <MergePersonButton
                person={{ id: customer.id, fullName: customer.fullName, code: customer.customerCode }}
              />
            )}
            {can(user, "customer.manage") && <EditCustomerButton customer={customer} />}
          </>
        }
      />
      {customer.pendingIdentity && (
        // D-018: the change is not in effect until an approver agrees.
        <p role="status" className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t("pendingIdentity", {
            changes: [
              customer.pendingIdentity.fullName !== undefined &&
                `${t("fields.fullName")}: ${customer.pendingIdentity.fullName}`,
              customer.pendingIdentity.phone !== undefined &&
                `${t("fields.phone")}: ${customer.pendingIdentity.phone ?? "—"}`,
              customer.pendingIdentity.email !== undefined &&
                `${t("fields.email")}: ${customer.pendingIdentity.email ?? "—"}`,
            ]
              .filter(Boolean)
              .join("; "),
          })}
        </p>
      )}
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
          {intake.length > 0 && (
            <Card className="mt-4 max-w-3xl" role="region" aria-label={t("intakeHistory")}>
              <CardHeader>
                <CardTitle>
                  <h2>{t("intakeHistory")}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LeadTimeline entries={intake} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        {contracts && (
          <TabsContent value="contracts" className="space-y-4">
            {can(user, "contract.create") && (
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
              canDelete={can(user, "payment.delete")}
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
