import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { getManualReport, listDevices, listHanging, listScans } from "@/lib/api/checkin";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { DevicesPanel } from "./devices-panel";
import { ScansTable } from "./scans-table";
import { HangingTable } from "./hanging-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

const VIEWS = ["hanging", "errors", "scans", "manual", "devices"] as const;
type View = (typeof VIEWS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkin");
  return { title: t("title") };
}

/** Fingerprint-ready check-in (M5.3b, D-069 to D-072): hanging sessions, scan errors, the report, and the machines. */
export default async function CheckinPage({ searchParams }: PageProps<"/checkin">) {
  const user = await requirePageUser();
  if (!can(user, "booking.view")) return <ForbiddenState />;

  const t = await getTranslations("checkin");
  const params = await searchParams;
  const allowed: Record<View, boolean> = {
    hanging: true,
    errors: can(user, "checkin.review"),
    scans: can(user, "checkin.review"),
    manual: can(user, "report.manualConfirmations"),
    devices: can(user, "checkin.devices"),
  };
  const visible = VIEWS.filter((v) => allowed[v]);
  const view: View = visible.find((v) => v === params.view) ?? "hanging";
  const { page, pageSize } = readPaging(params);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <nav aria-label={t("title")} className="mb-4 flex flex-wrap gap-2">
        {visible.map((v) => (
          <Button key={v} variant={v === view ? "secondary" : "ghost"} size="sm" asChild>
            <Link
              href={v === "hanging" ? "/checkin" : `/checkin?view=${v}`}
              aria-current={v === view ? "page" : undefined}
            >
              {t(`views.${v}`)}
            </Link>
          </Button>
        ))}
      </nav>
      {view === "hanging" && (
        <HangingTable
          rows={await listHanging()}
          canComplete={can(user, "session.complete")}
          canAnswer={can(user, "booking.manage")}
        />
      )}
      {(view === "errors" || view === "scans") && (
        <ScansPanel view={view} params={params} page={page} pageSize={pageSize} />
      )}
      {view === "manual" && <ManualReport />}
      {view === "devices" && <DevicesPanel devices={await listDevices()} branches={user.branches} />}
    </>
  );
}

async function ScansPanel({
  view,
  params,
  page,
  pageSize,
}: {
  view: "errors" | "scans";
  params: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
}) {
  const scans = await listScans({ result: view === "errors" ? "ERROR" : undefined, page, pageSize });
  return (
    <ScansTable
      scans={scans.items}
      view={view}
      footer={
        <TablePagination
          page={scans.page}
          pageSize={scans.pageSize}
          total={scans.total}
          path="/checkin"
          params={params}
        />
      }
    />
  );
}

/** Sessions confirmed by hand this month, per PT and per customer (D-071). */
async function ManualReport() {
  const t = await getTranslations("checkin");
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const report = await getManualReport({ from: formatDateOnly(monthStart), to: formatDateOnly(today) });
  const block = (title: string, rows: { id: string; name: string; sessions: number }[]) => (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("manualEmpty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between px-3 py-2 text-sm">
              <span>{row.name}</span>
              <span className="tabular-nums">{row.sessions}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t("manualIntro", { from: formatDateOnly(monthStart), to: formatDateOnly(today), total: report.total })}
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        {block(t("manualPerTrainer"), report.perTrainer)}
        {block(t("manualPerCustomer"), report.perCustomer)}
      </div>
    </div>
  );
}
