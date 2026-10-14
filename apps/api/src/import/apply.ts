import { randomUUID } from "node:crypto";
import type { ImportSheet } from "@flow/shared/import";
import { createCustomer } from "../modules/customers/customer.service.js";
import { createEmployee } from "../modules/employees/employee.service.js";
import * as contractRepo from "../modules/contracts/contract.repository.js";
import { recordAudit } from "../platform/audit/audit.repository.js";
import type { CurrentUser } from "../platform/auth/actor.js";
import { prisma } from "../platform/db/prisma.js";
import { AppError } from "../platform/errors/app-error.js";
import type { Plan, PlannedContract } from "./plan.js";

// Carrying out an import plan (brief §11, D-039, D-011; M9.2). Each record is written on its own and carries its legacy
// code, so a run that stops can be run again: what was brought over is skipped by its legacy code.

export type Outcome = { created: number; failed: { legacyCode: string; row: number; reason: string }[] };
export type Applied = Record<ImportSheet, Outcome>;

const reasonOf = (error: unknown): string =>
  error instanceof AppError ? error.code : error instanceof Error ? error.message.slice(0, 200) : "unknown";

type Context = { actor: CurrentUser; branchId: string };

async function createContractRow(context: Context, planned: PlannedContract): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { legacyCode: planned.customerLegacyCode },
    select: { id: true },
  });
  if (!customer) throw new AppError("NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    const created = await contractRepo.createContract(
      tx,
      {
        customerId: customer.id,
        branchId: context.branchId,
        contractCode: await contractRepo.nextContractCode(tx),
        idempotencyKey: `import:${planned.entry.legacyCode}`,
        createdById: context.actor.id,
        legacyCode: planned.entry.legacyCode,
        packageName: planned.newName,
        serviceId: planned.serviceId,
        priceTierId: planned.tierId,
        contractType: "NEW",
        contractDate: planned.contractDate,
        // What was agreed, as it stands in GymMaster; the opening balances below are immutable (D-011).
        contractValue: planned.value,
        totalSessions: planned.sessions,
        openingSessionsUsed: planned.sessionsUsed,
        openingPaidAmount: planned.paid,
        startDate: planned.startDate,
        endDate: planned.endDate,
        tierUnitPrice: planned.tierUnitPrice,
        approvedUnitPrice: Math.round(planned.value / planned.sessions),
        isExceptionPrice: planned.cleanup.includes("PRICE_DIFFERS_FROM_TIER"),
        isImported: true,
        notes: planned.packageName === planned.newName ? null : `GymMaster: ${planned.packageName}`,
      },
      [],
      [],
    );
    if ((await contractRepo.approve(tx, created.id, context.actor.id, new Date())) !== 1) {
      throw new AppError("INTERNAL_ERROR");
    }
    await recordAudit(tx, {
      actorUserId: context.actor.id,
      entityType: "contract",
      entityId: created.id,
      action: "contract.imported",
      after: {
        contractCode: created.contractCode,
        legacyCode: planned.entry.legacyCode,
        sessions: planned.sessions,
        sessionsUsed: planned.sessionsUsed,
        value: planned.value,
        paid: planned.paid,
        cleanup: planned.cleanup,
      },
    });
  });
}

/** Writes the rows the plan says to create, customers first, then staff, then the contracts that name them. */
export async function applyPlan(context: Context, plan: Plan): Promise<Applied> {
  const applied: Applied = {
    customers: { created: 0, failed: [] },
    staff: { created: 0, failed: [] },
    contracts: { created: 0, failed: [] },
  };
  const run = async (
    sheet: ImportSheet,
    items: { entry: Plan["customers"][number]["entry"] }[],
    write: (index: number) => Promise<void>,
  ) => {
    for (const [index, item] of items.entries()) {
      if (item.entry.action !== "CREATE") continue;
      try {
        await write(index);
        applied[sheet].created += 1;
      } catch (error) {
        applied[sheet].failed.push({ legacyCode: item.entry.legacyCode, row: item.entry.row, reason: reasonOf(error) });
      }
    }
  };

  await run("customers", plan.customers, async (index) => {
    const planned = plan.customers[index]!;
    const customer = await createCustomer(context.actor, { ...planned.input, branchId: context.branchId });
    await prisma.customer.update({ where: { id: customer.id }, data: { legacyCode: planned.entry.legacyCode } });
  });
  await run("staff", plan.staff, async (index) => {
    const planned = plan.staff[index]!;
    const employee = await createEmployee(context.actor, {
      ...planned.input,
      branchId: context.branchId,
      status: "ACTIVE",
    });
    await prisma.employee.update({ where: { id: employee.id }, data: { legacyCode: planned.entry.legacyCode } });
  });
  await run("contracts", plan.contracts, (index) => createContractRow(context, plan.contracts[index]!));
  return applied;
}

/** The run on record: what file, how many of each, and the cleanup list the owner confirms. */
export async function recordRun(context: Context, source: string, plan: Plan, applied: Applied): Promise<string> {
  const id = randomUUID();
  const cleanup = plan.contracts
    .filter((contract) => contract.cleanup.length > 0)
    .map((contract) => ({ legacyCode: contract.entry.legacyCode, reasons: contract.cleanup }));
  await prisma.importRun.create({
    data: {
      id,
      source,
      branchId: context.branchId,
      createdById: context.actor.id,
      counts: JSON.parse(JSON.stringify(applied)),
      cleanup,
    },
  });
  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      actorUserId: context.actor.id,
      entityType: "import_run",
      entityId: id,
      action: "import.completed",
      after: {
        source,
        customers: applied.customers.created,
        staff: applied.staff.created,
        contracts: applied.contracts.created,
        cleanup: cleanup.length,
      },
    }),
  );
  return id;
}
