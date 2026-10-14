import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { countryName } from "@flow/shared/countries";
import { BanknoteIcon, CalendarIcon, FileTextIcon, MessagesSquareIcon } from "lucide-react";
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
import { getCustomer, listCustomerStaff } from "@/lib/api/customers";
import { getLeadChecklist, getLeadTimeline } from "@/lib/api/leads";
import { listContracts } from "@/lib/api/contracts";
import { listBookings } from "@/lib/api/bookings";
import { listPayments } from "@/lib/api/finance";
import { listCustomerEmails } from "@/lib/api/mail";
import { listTrainersOfDay } from "@/lib/api/employees";
import { listLogs } from "@/lib/api/workout-logs";
import { listPlans } from "@/lib/api/workout-plans";
import { env } from "@/lib/env";
import { formatDateOnly } from "@/lib/format";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { CustomerEmails } from "./customer-emails";
import { CustomerPlans } from "./customer-plans";
import { bookingContext } from "../../bookings/booking-context";
import { AddBookingButton, BookingsTable } from "../../bookings/bookings-table";
import { CreateContractButton } from "../../contracts/contract-buttons";
import { PaymentsTable } from "../../finance/payments";
import { ContractsTable } from "../../contracts/contracts-table";
import { EditCustomerButton } from "../customer-sheets";
import { LeadTimeline } from "../../leads/lead-timeline";
import { ChecklistSteps } from "../../leads/lead-checklist";
import { MergePersonButton } from "../../leads/merge-person";
import { MachineCodeSection } from "../../checkin/machine-code-section";

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
  const locale = await getLocale();
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
  const emails = await listCustomerEmails(customer.id, { pageSize: 100 });
  const canSeePlans = can(user, "workout.view");
  const plans = canSeePlans ? await loadPlans(user, customer.id, contracts?.items ?? []) : null;

  const details: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.customerCode"), value: <span className="font-mono">{customer.customerCode}</span> },
    { label: t("fields.branch"), value: customer.branch.name },
    { label: t("fields.phone"), value: customer.maskedFields.includes("phone") ? <HiddenValue /> : customer.phone },
    { label: t("fields.email"), value: customer.maskedFields.includes("email") ? <HiddenValue /> : customer.email },
    {
      label: t("fields.dateOfBirth"),
      value: customer.dateOfBirth && <DateTime value={customer.dateOfBirth} format="dateOnly" />,
    },
    {
      label: t("fields.nationality"),
      value: customer.countryCode ? countryName(customer.countryCode, locale) : customer.nationality,
    },
    {
      label: t("fields.address"),
      value: customer.maskedFields.includes("address") ? (
        <HiddenValue />
      ) : (
        customer.address && <span className="whitespace-pre-line">{customer.address}</span>
      ),
    },
    {
      label: t("fields.emergencyContact"),
      value: customer.maskedFields.includes("address") ? (
        <HiddenValue />
      ) : (
        [customer.emergencyContactName, customer.emergencyContactPhone].filter(Boolean).join(" · ")
      ),
    },
    {
      label: t("fields.customerGroup"),
      value: customer.customerGroup && (
        <>
          {user.locale === "vi" ? customer.customerGroup.labelVi : customer.customerGroup.labelEn}
          {customer.customerGroup.note && `: ${customer.customerGroup.note}`}
        </>
      ),
    },
    { label: t("fields.staffInCharge"), value: customer.staffInCharge?.name },
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
    {
      label: t("fields.contractStatus"),
      value: <StatusBadge entity="customerContract" status={customer.contractStatus} />,
    },
    { label: t("fields.createdAt"), value: <DateTime value={customer.createdAt} format="dateTime" /> },
    {
      label: t("fields.notes"),
      value: customer.notes && <span className="whitespace-pre-line">{customer.notes}</span>,
    },
  ];

  // The Consulting history tab (A-076): the lead's timeline with notes, inquiries, and merges (BR-202), and its checklist.
  const consulting = can(user, "lead.view") ? await loadConsulting(customer.id) : null;
  const staff = can(user, "customer.manage") ? await listCustomerStaff() : [];

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
            {can(user, "customer.manage") && <EditCustomerButton customer={customer} staff={staff} />}
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
          {consulting && <TabsTrigger value="consulting">{t("tabs.consulting")}</TabsTrigger>}
          {plans && <TabsTrigger value="plans">{t("tabs.plans")}</TabsTrigger>}
          <TabsTrigger value="emails">{t("tabs.emails")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <MachineCodeSection user={user} subject="customer" id={customer.id} />
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
              canEditDate={can(user, "payment.editDate")}
              label={t("tabs.payments")}
              hide={{ customer: true }}
              empty={<EmptyState icon={BanknoteIcon} title={tc("paymentHistoryEmpty")} />}
            />
          </TabsContent>
        )}
        {consulting && (
          <TabsContent value="consulting" className="space-y-4">
            {consulting.timeline.length === 0 ? (
              <EmptyState icon={MessagesSquareIcon} title={t("consulting.empty")} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card role="region" aria-label={t("consulting.timeline")}>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t("consulting.timeline")}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LeadTimeline entries={consulting.timeline} />
                  </CardContent>
                </Card>
                <Card role="region" aria-label={t("consulting.checklist")}>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t("consulting.checklist")}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChecklistSteps lead={null} steps={consulting.checklist} canComplete={false} />
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        )}
        {plans && (
          <TabsContent value="plans">
            <CustomerPlans customerId={customer.id} {...plans} />
          </TabsContent>
        )}
        <TabsContent value="emails">
          <CustomerEmails emails={emails.items} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** A customer who never was a lead has no history; the timeline then comes back empty. */
async function loadConsulting(id: string) {
  const [timeline, checklist] = await Promise.all([getLeadTimeline(id), getLeadChecklist(id)]);
  return { timeline: timeline.items, checklist: checklist.items };
}

async function NotProvided() {
  const t = await getTranslations("common");
  return <span className="text-muted-foreground">{t("notProvided")}</span>;
}

/** What the plans tab needs (M7.2): the customer's plans, and what a new plan is made from. */
async function loadPlans(
  user: Awaited<ReturnType<typeof requirePageUser>>,
  customerId: string,
  contracts: { id: string; contractCode: string; packageName: string; status: string }[],
) {
  const [plans, logs, templates, trainers] = await Promise.all([
    listPlans({ customerId, kind: "CUSTOMER", pageSize: 100 }),
    listLogs({ customerId, pageSize: 100 }),
    can(user, "workout.plan") ? listPlans({ kind: "TEMPLATE", status: "APPROVED", pageSize: 100 }) : null,
    // A PT's plan is their own; whoever reviews names the coach.
    can(user, "workout.plan") && can(user, "workout.review")
      ? listTrainersOfDay(formatDateOnly(calendarDateInTimeZone(env.GYM_TIMEZONE)))
      : null,
  ]);
  return {
    plans: plans.items,
    logs: logs.items,
    canCreate: can(user, "workout.plan"),
    contracts: contracts
      .filter((contract) => contract.status === "ACTIVE" || contract.status === "FROZEN")
      .map((contract) => ({ id: contract.id, label: `${contract.contractCode} · ${contract.packageName}` })),
    templates: (templates?.items ?? []).map((template) => ({ id: template.id, name: template.name })),
    trainers: trainers ? trainers.map((entry) => ({ id: entry.trainer.id, name: entry.trainer.fullName })) : null,
  };
}
