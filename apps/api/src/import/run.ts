import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import type { CurrentUser } from "../platform/auth/actor.js";
import { loadCurrentUser } from "../platform/auth/actor.js";
import { prisma } from "../platform/db/prisma.js";
import { env } from "../platform/env.js";
import { applyPlan, recordRun, type Applied } from "./apply.js";
import { buildPlan, type Plan } from "./plan.js";
import { writeReport } from "./report.js";
import { readWorkbook, type ImportSource } from "./workbook.js";

// One import run (brief §11, D-039; M9.2): read the workbook, check every row, and, only when asked, write.

export type RunOptions = {
  /** The workbook (a path or its bytes), or GymMaster's exports, one file each (M9.2b). */
  source: ImportSource | ImportSource[];
  /** The name shown on record. */
  sourceName: string;
  /** The Admin the import is done as; the records say they were made by this account. */
  userEmail: string;
  /** The branch the records belong to: its name or id; the only active branch when empty. */
  branch?: string;
  /** Without it nothing is written. */
  commit: boolean;
  /** Needed to write in production, where the import waits for the owner's word (OQ-014). */
  confirmProduction?: boolean;
  /** The environment the command runs in; the API's own when left out. */
  nodeEnv?: string;
};

/** A real run in production is refused unless it is confirmed on purpose: production waits for OQ-014 (M9.3). */
export function assertCommitAllowed(options: Pick<RunOptions, "commit" | "confirmProduction" | "nodeEnv">): void {
  if (options.commit && (options.nodeEnv ?? env.NODE_ENV) === "production" && !options.confirmProduction) {
    throw new Error(
      "Production import refused: it waits for the owner's sign-off (OQ-014). Add --confirm-production when it is given.",
    );
  }
}

export type RunResult = { plan: Plan; applied: Applied | null; runId: string | null; report: Buffer };

async function actorOf(email: string): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  const actor = user ? await loadCurrentUser(prisma, user.id) : null;
  if (!actor) throw new Error(`No user with the email ${email}`);
  if (
    actor.branches !== "ALL" ||
    !actor.permissions.has("customer.manage") ||
    !actor.permissions.has("employee.manage")
  ) {
    throw new Error("The import must be done as an Admin with every branch");
  }
  return actor;
}

async function branchOf(branch: string | undefined): Promise<string> {
  const active = await prisma.branch.findMany({ where: { active: true }, select: { id: true, name: true } });
  if (!branch) {
    if (active.length !== 1) throw new Error("Name the branch (--branch): there is more than one active branch");
    return active[0]!.id;
  }
  const found = active.find(
    (candidate) => candidate.id === branch || candidate.name.toLowerCase() === branch.toLowerCase(),
  );
  if (!found) throw new Error(`No active branch ${branch}`);
  return found.id;
}

export async function runImport(options: RunOptions): Promise<RunResult> {
  assertCommitAllowed(options);
  const actor = await actorOf(options.userEmail);
  const branchId = await branchOf(options.branch);
  const workbook = await readWorkbook(options.source);
  const context = { db: prisma, actor, branchId, today: calendarDateInTimeZone(env.GYM_TIMEZONE) };
  const plan = await buildPlan(context, workbook);
  if (!options.commit) return { plan, applied: null, runId: null, report: await writeReport(plan, "DRY_RUN", null) };
  const applied = await applyPlan({ actor, branchId }, plan);
  const runId = await recordRun({ actor, branchId }, options.sourceName, plan, applied);
  return { plan, applied, runId, report: await writeReport(plan, "COMMIT", applied) };
}
