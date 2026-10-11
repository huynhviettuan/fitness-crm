import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getEmployee, getWorkSchedule, listEmployeeLogins } from "@/lib/api/employees";
import type { ChosenOption } from "@flow/shared/options";
import { EditEmployeeButton } from "../employee-form";
import { DaysOff, ShiftsEditor } from "./work-schedule";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

async function loadEmployee(id: string) {
  try {
    return await getEmployee(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/employees/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "employee.view")) return {};
  const employee = await loadEmployee((await params).id);
  return { title: `${employee.employeeCode} · ${employee.fullName}` };
}

/** One employee (brief §8.4): profile, weekly shifts, and days off (D-030). */
export default async function EmployeePage({ params }: PageProps<"/employees/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "employee.view")) return <ForbiddenState />;

  const t = await getTranslations("employees");
  const employee = await loadEmployee((await params).id);
  const canManage = can(user, "employee.manage");
  const [schedule, logins] = await Promise.all([getWorkSchedule(employee.id), canManage ? listEmployeeLogins() : Promise.resolve([])]);
  const chosen = (option: ChosenOption | null) => {
    if (!option) return null;
    const label = user.locale === "vi" ? option.labelVi : option.labelEn;
    return option.note ? `${label}: ${option.note}` : label;
  };

  const profile: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.employeeCode"), value: <span className="font-mono">{employee.employeeCode}</span> },
    { label: t("fields.status"), value: <StatusBadge entity="employee" status={employee.status} /> },
    { label: t("fields.branch"), value: employee.branch.name },
    { label: t("fields.isTrainer"), value: employee.isTrainer ? t("trainer") : "—" },
    { label: t("fields.birthDate"), value: employee.birthDate ? <DateTime value={employee.birthDate} format="dateOnly" /> : null },
    { label: t("fields.gender"), value: employee.gender ? t(`genders.${employee.gender}`) : null },
    { label: t("fields.phone"), value: employee.phone },
    { label: t("fields.email"), value: employee.email },
    { label: t("fields.department"), value: chosen(employee.department) },
    { label: t("fields.team"), value: employee.team },
    { label: t("fields.title"), value: chosen(employee.title) },
    { label: t("fields.login"), value: employee.user ? `${employee.user.name} · ${employee.user.email}` : t("noLogin") },
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/employees">
          <ArrowLeftIcon />
          {t("backToList")}
        </Link>
      </Button>
      <PageHeader
        title={`${employee.employeeCode} · ${employee.fullName}`}
        actions={canManage && <EditEmployeeButton employee={employee} logins={logins} branches={user.branches} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("profile")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              {profile.map((item) => (
                <div key={item.label} className="contents">
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="text-sm break-words">{item.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("schedule.title")}</CardTitle>
              <CardDescription>{employee.isTrainer ? t("schedule.description") : t("schedule.notTrainer")}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Remount after a save, so the editor starts from what was stored. */}
              <ShiftsEditor key={JSON.stringify(schedule.shifts)} employeeId={employee.id} shifts={schedule.shifts} editable={canManage} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("schedule.daysOff")}</CardTitle>
              <CardDescription>{t("schedule.daysOffDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <DaysOff employeeId={employee.id} daysOff={schedule.daysOff} editable={canManage} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
