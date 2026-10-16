import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { filterValue } from "@/lib/filters";
import { listContractStaff, listContracts, type ContractListParams } from "@/lib/api/contracts";
import { listPromotions } from "@/lib/api/promotions";
import { listServices } from "@/lib/api/services";
import { CONTRACT_TYPES, LIST_STATUSES, PAYMENT_STATUSES } from "@gymcrm/shared/contracts";
import { parseDateOnly } from "@gymcrm/shared/validation";
import { ContractsTable } from "./contracts-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("title") };
}

/** A day typed as dd/MM/yyyy; anything else is ignored rather than refused. */
const day = (param: string | string[] | undefined) => {
  const value = filterValue(param);
  return value && parseDateOnly(value) ? value : undefined;
};
const oneOf = <T extends string>(param: string | string[] | undefined, values: readonly T[]) =>
  values.find((value) => value === filterValue(param));

// Contracts are created from a customer's page, so this list has no create button.
/** The contract list in the shared template (brief §5.3): filters left, totals of the filter, every column. */
export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const user = await requirePageUser();
  if (!can(user, "contract.view")) return <ForbiddenState />;
  const t = await getTranslations("contracts");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const { page, pageSize } = readPaging(params);

  const branchId = user.branches.find((branch) => branch.id === filterValue(params.branch))?.id;
  // What the filters offer is what this user may read: services and promotions need service.view, PTs contract.create.
  const [services, promotions, staff] = await Promise.all([
    can(user, "service.view") ? listServices() : [],
    can(user, "service.view") ? listPromotions({ onOffer: true }) : [],
    can(user, "contract.create") ? listContractStaff(branchId ?? user.branches[0]?.id) : [],
  ]);
  const trainers = staff.filter((person) => person.isTrainer);
  const filters: ContractListParams = {
    branchId,
    contractType: oneOf(params.type, CONTRACT_TYPES),
    from: day(params.from),
    to: day(params.to),
    serviceId: services.find((service) => service.id === filterValue(params.service))?.id,
    ptId: trainers.find((person) => person.id === filterValue(params.pt))?.id,
    promotionId: promotions.find((promotion) => promotion.id === filterValue(params.promotion))?.id,
    paymentStatus: oneOf(params.payment, PAYMENT_STATUSES),
    signed: oneOf(params.signed, ["true", "false"] as const),
    status: oneOf(params.status, LIST_STATUSES),
  };
  const query = Object.fromEntries(Object.entries({ q, ...filters }).filter(([, value]) => value)) as Record<
    string,
    string
  >;

  const result = await listContracts({ ...filters, q, page, pageSize });
  const filtered = Object.keys(query).length > 0;

  const totals = [
    { label: t("fields.contractValue"), amount: result.totals?.contractValue },
    { label: t("fields.paidAmount"), amount: result.totals?.paidAmount },
    { label: t("fields.debt"), amount: result.totals?.debt },
  ];
  const choices = <T extends string>(values: readonly T[], label: (value: T) => string) =>
    values.map((value) => ({ value, label: label(value) }));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={can(user, "contract.export") && <ExportButton path="/api/v1/contracts/export" query={query} />}
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/contracts" label={t("filters")} submitLabel={t("apply")}>
          {q && <input type="hidden" name="q" value={q} />}
          {user.branches.length > 1 && (
            <FilterSelect
              name="branch"
              label={t("fields.branch")}
              allLabel={t("allBranches")}
              value={filters.branchId}
              options={user.branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          )}
          <FilterSelect
            name="type"
            label={t("fields.contractType")}
            allLabel={t("allTypes")}
            value={filters.contractType}
            options={choices(CONTRACT_TYPES, (type) => t(`types.${type}`))}
          />
          <FilterInput name="from" label={t("dateFrom")} value={filters.from} placeholder={t("datePlaceholder")} />
          <FilterInput name="to" label={t("dateTo")} value={filters.to} placeholder={t("datePlaceholder")} />
          {services.length > 0 && (
            <FilterSelect
              name="service"
              label={t("fields.service")}
              allLabel={t("allServices")}
              value={filters.serviceId}
              options={services.map((service) => ({ value: service.id, label: service.name }))}
            />
          )}
          {trainers.length > 0 && (
            <FilterSelect
              name="pt"
              label={t("filterPt")}
              allLabel={t("allPts")}
              value={filters.ptId}
              options={trainers.map((person) => ({ value: person.id, label: person.fullName }))}
            />
          )}
          {promotions.length > 0 && (
            <FilterSelect
              name="promotion"
              label={t("fields.promotion")}
              allLabel={t("allPromotions")}
              value={filters.promotionId}
              options={promotions.map((promotion) => ({ value: promotion.id, label: promotion.name }))}
            />
          )}
          <FilterSelect
            name="payment"
            label={t("filterPayment")}
            allLabel={t("allPayments")}
            value={filters.paymentStatus}
            options={choices(PAYMENT_STATUSES, (status) => t(`paymentStatuses.${status}`))}
          />
          <FilterSelect
            name="signed"
            label={t("filterSigned")}
            allLabel={t("allSigned")}
            value={filters.signed}
            options={[
              { value: "true", label: t("signedYes") },
              { value: "false", label: t("signedNo") },
            ]}
          />
          <FilterSelect
            name="status"
            label={t("filterApproval")}
            allLabel={t("allStatuses")}
            value={filters.status}
            options={choices(LIST_STATUSES, (status) => t(`statuses.${status}`))}
          />
        </FilterPanel>
        <div className="min-w-0">
          <section aria-label={t("totalsLabel")} className="mb-4 grid gap-4 sm:grid-cols-3">
            {totals.map(({ label, amount }) => (
              <Card key={label}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    <h3>{label}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xl font-semibold">
                  {amount === undefined ? <HiddenValue /> : <Money amount={amount} />}
                </CardContent>
              </Card>
            ))}
          </section>
          <Form action="/contracts" role="search" className="relative mb-4 max-w-sm">
            {Object.entries(query)
              .filter(([key]) => key !== "q")
              .map(([key, value]) => (
                <input key={key} type="hidden" name={URL_NAMES[key] ?? key} value={value} />
              ))}
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="pl-8"
            />
          </Form>
          <ContractsTable
            full
            contracts={result.items}
            empty={
              filtered ? (
                <EmptyState
                  icon={SearchIcon}
                  title={t("noResultsTitle")}
                  description={q ? t("noResultsBody", { q }) : t("noResultsFilters")}
                />
              ) : (
                <EmptyState icon={FileTextIcon} title={t("emptyTitle")} description={t("emptyBody")} />
              )
            }
            footer={
              <TablePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                path="/contracts"
                params={params}
              />
            }
          />
        </div>
      </div>
    </>
  );
}

/** The API's filter names back to the page's own URL names, for the search box to keep the filters. */
const URL_NAMES: Record<string, string> = {
  branchId: "branch",
  contractType: "type",
  serviceId: "service",
  ptId: "pt",
  promotionId: "promotion",
  paymentStatus: "payment",
};
