import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { env } from "@/lib/env";
import { filterValue } from "@/lib/filters";
import { formatDateOnly } from "@/lib/format";
import { listTrainersOfDay } from "@/lib/api/employees";
import { calendarDateInTimeZone, parseDateOnly } from "@flow/shared/validation";

/** A day typed as dd/MM/yyyy; anything else is ignored rather than refused. */
function day(param: string | string[] | undefined) {
  const value = filterValue(param);
  return value && parseDateOnly(value) ? value : undefined;
}

/** The cohort a report is about, read from the URL: leads created in a period, in a branch, of a person (A-089). */
export function readReportParams(
  params: Record<string, string | string[] | undefined>,
  branches: { id: string }[],
  staff: { id: string }[],
) {
  return {
    from: day(params.from),
    to: day(params.to),
    branchId: branches.find((branch) => branch.id === filterValue(params.branch))?.id,
    staffId: staff.find((person) => person.id === filterValue(params.staff))?.id,
  };
}

/** The filters every report has (brief §9): period, branch, and staff. */
export async function ReportFilters({
  path,
  values,
  branches,
  staff,
}: {
  path: string;
  values: ReturnType<typeof readReportParams>;
  branches: { id: string; name: string }[];
  staff: { id: string; name: string }[];
}) {
  const t = await getTranslations("reports");
  return (
    <FilterPanel action={path} label={t("filters")} submitLabel={t("apply")}>
      <FilterInput name="from" label={t("from")} value={values.from} placeholder={t("dayHint")} />
      <FilterInput name="to" label={t("to")} value={values.to} placeholder={t("dayHint")} />
      {branches.length > 1 && (
        <FilterSelect
          name="branch"
          label={t("branch")}
          allLabel={t("allBranches")}
          value={values.branchId}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />
      )}
      <FilterSelect
        name="staff"
        label={t("staff")}
        allLabel={t("allStaff")}
        value={values.staffId}
        options={staff.map((person) => ({ value: person.id, label: person.name }))}
      />
    </FilterPanel>
  );
}

/** The period and branch of a money or contract report, read from the URL; empty means this month (M4.7). */
export function readPeriodParams(params: Record<string, string | string[] | undefined>, branches: { id: string }[]) {
  return {
    from: day(params.from),
    to: day(params.to),
    branchId: branches.find((branch) => branch.id === filterValue(params.branch))?.id,
  };
}

/** The filters of the money and contract reports: period and branch (brief §9). */
export async function PeriodFilters({
  path,
  values,
  branches,
}: {
  path: string;
  values: ReturnType<typeof readPeriodParams>;
  branches: { id: string; name: string }[];
}) {
  const t = await getTranslations("reports");
  return (
    <FilterPanel action={path} label={t("filters")} submitLabel={t("apply")}>
      <FilterInput name="from" label={t("from")} value={values.from} placeholder={t("dayHint")} />
      <FilterInput name="to" label={t("to")} value={values.to} placeholder={t("dayHint")} />
      {branches.length > 1 && (
        <FilterSelect
          name="branch"
          label={t("branch")}
          allLabel={t("allBranches")}
          value={values.branchId}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />
      )}
    </FilterPanel>
  );
}

/** The period, branch, and PT of the PT reports, read from the URL (M5.6). */
export function readTrainerParams(
  params: Record<string, string | string[] | undefined>,
  branches: { id: string }[],
  trainers: { id: string }[],
) {
  return {
    ...readPeriodParams(params, branches),
    trainerId: trainers.find((trainer) => trainer.id === filterValue(params.trainer))?.id,
  };
}

/** The filters of the PT reports: period, branch, and PT, and the report's own filters after them (M5.6). */
export async function TrainerFilters({
  path,
  values,
  branches,
  trainers,
  children,
}: {
  path: string;
  values: ReturnType<typeof readTrainerParams>;
  branches: { id: string; name: string }[];
  trainers: { id: string; name: string }[];
  children?: ReactNode;
}) {
  const t = await getTranslations("reports");
  return (
    <FilterPanel action={path} label={t("filters")} submitLabel={t("apply")}>
      <FilterInput name="from" label={t("from")} value={values.from} placeholder={t("dayHint")} />
      <FilterInput name="to" label={t("to")} value={values.to} placeholder={t("dayHint")} />
      {branches.length > 1 && (
        <FilterSelect
          name="branch"
          label={t("branch")}
          allLabel={t("allBranches")}
          value={values.branchId}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />
      )}
      <FilterSelect
        name="trainer"
        label={t("trainer")}
        allLabel={t("allTrainers")}
        value={values.trainerId}
        options={trainers.map((trainer) => ({ value: trainer.id, label: trainer.name }))}
      />
      {children}
    </FilterPanel>
  );
}

/**
 * The active PTs to pick from in the PT reports. The PT calendar's list is used because reception and the books
 * hold `trainer.view`, not the employee list (M5.6).
 */
export async function listReportTrainers(): Promise<{ id: string; name: string }[]> {
  const today = formatDateOnly(calendarDateInTimeZone(env.GYM_TIMEZONE));
  return (await listTrainersOfDay(today)).map((entry) => ({ id: entry.trainer.id, name: entry.trainer.fullName }));
}
