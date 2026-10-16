import { periodReportQuerySchema } from "@gymcrm/shared/finance";
import {
  percentOf,
  type ContractReport,
  type ContractReportRow,
  type ExceptionPriceReport,
  type ExceptionPriceRow,
} from "@gymcrm/shared/contracts";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { env } from "../../platform/env.js";
import { prisma } from "../../platform/db/prisma.js";
import type { Actor } from "../../platform/auth/session.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { isMasked } from "../../platform/permissions/scope.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as repo from "./contract-report.repository.js";
import { assertWholeScope, branchesOf, periodOf } from "./report-scope.js";

// The contract report and the exception-price report (brief §9, D-041; A-140, A-141).

const EMPTY_TOTALS = {
  newContracts: 0,
  renewedContracts: 0,
  value: 0,
  revenue: 0,
  debt: 0,
  expiringSoon: 0,
  runningOut: 0,
};

/**
 * Revenue, debt, new and renewed contracts, and the contracts expiring or running out, grouped by service and
 * session-tier band (brief §9, A-140). Money hidden from the actor's role makes the report refused (D-017).
 */
export async function contractReport(actor: Actor, rawQuery: unknown): Promise<ContractReport> {
  assertCan(actor, "report.contracts");
  assertWholeScope(actor, "contracts", "report.contracts");
  if (isMasked(actor, "receipts.totals")) throw forbidden(actor, "report.contracts", "maskedMoney");
  const query = parseInput(periodReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const [expiringSoonDays, runningOutSessions] = await Promise.all([
    readParameter(prisma, "expiringSoonDays"),
    readParameter(prisma, "runningOutSessions"),
  ]);
  const groups = await repo.contractGroups(
    prisma,
    branches,
    { from, to },
    {
      today: calendarDateInTimeZone(env.GYM_TIMEZONE),
      expiringSoonDays: Number(expiringSoonDays),
      runningOutSessions: Number(runningOutSessions),
    },
  );

  const rows: ContractReportRow[] = groups
    .filter((group) => Object.entries(EMPTY_TOTALS).some(([key]) => group[key as keyof typeof EMPTY_TOTALS] !== 0))
    .map((group) => ({
      service: group.serviceId && group.serviceName ? { id: group.serviceId, name: group.serviceName } : null,
      band: group.minSessions === null ? null : { min: group.minSessions, max: group.maxSessions },
      newContracts: group.newContracts,
      renewedContracts: group.renewedContracts,
      value: group.value,
      revenue: group.revenue,
      debt: group.debt,
      expiringSoon: group.expiringSoon,
      runningOut: group.runningOut,
    }))
    .sort(
      (a, b) =>
        (a.service?.name ?? "").localeCompare(b.service?.name ?? "") || (a.band?.min ?? -1) - (b.band?.min ?? -1),
    );
  const totals = rows.reduce(
    (sum, row) => ({
      newContracts: sum.newContracts + row.newContracts,
      renewedContracts: sum.renewedContracts + row.renewedContracts,
      value: sum.value + row.value,
      revenue: sum.revenue + row.revenue,
      debt: sum.debt + row.debt,
      expiringSoon: sum.expiringSoon + row.expiringSoon,
      runningOut: sum.runningOut + row.runningOut,
    }),
    EMPTY_TOTALS,
  );
  return { from, to, rows, totals };
}

function toRow(group: repo.ExceptionGroupRow): ExceptionPriceRow {
  return {
    user: { id: group.userId, name: group.name },
    contracts: group.contracts,
    exceptions: group.exceptions,
    share: percentOf(group.exceptions, group.contracts),
    difference: group.difference,
  };
}

/**
 * The share of approved contracts that carry an exception price and what the exceptions cost against the tier price,
 * by who created and by who approved them (brief §9, BR-302, A-141).
 */
export async function exceptionPriceReport(actor: Actor, rawQuery: unknown): Promise<ExceptionPriceReport> {
  assertCan(actor, "report.exceptionPrices");
  assertWholeScope(actor, "contracts", "report.exceptionPrices");
  const query = parseInput(periodReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const [creators, approvers] = await Promise.all([
    repo.exceptionGroups(prisma, branches, { from, to }, "created_by"),
    repo.exceptionGroups(prisma, branches, { from, to }, "approved_by"),
  ]);
  const order = (a: ExceptionPriceRow, b: ExceptionPriceRow) =>
    b.difference - a.difference || b.exceptions - a.exceptions || a.user.name.localeCompare(b.user.name);
  const contracts = creators.reduce((sum, group) => sum + group.contracts, 0);
  const exceptions = creators.reduce((sum, group) => sum + group.exceptions, 0);
  return {
    from,
    to,
    byCreator: creators.map(toRow).sort(order),
    byApprover: approvers.map(toRow).sort(order),
    totals: {
      contracts,
      exceptions,
      share: percentOf(exceptions, contracts),
      difference: creators.reduce((sum, group) => sum + group.difference, 0),
    },
  };
}
