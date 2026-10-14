import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { prisma } from "../platform/db/prisma.js";
import { summarize } from "./plan.js";
import { reconcile, writeReconciliation } from "./reconcile.js";
import { runImport } from "./run.js";
import { readWorkbook, writeTemplate } from "./workbook.js";

// The GymMaster import command (brief §11, D-039; M9.2). Staging first: it writes nothing unless --commit is given.
//
//   pnpm --filter api import:template out.xlsx                  the blank workbook to fill from GymMaster
//   pnpm --filter api import:gymmaster -- --file in.xlsx --user admin@example.com [--branch Name] [--report out.xlsx] [--commit]

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const template = arg("template");
  if (template) {
    await writeFile(template, await writeTemplate());
    console.log(`Template written to ${template}`);
    return;
  }
  const file = arg("file");
  if (process.argv.includes("--reconcile")) {
    if (!file) {
      console.error("Usage: --reconcile --file <workbook.xlsx> [--report <out.xlsx>]");
      process.exitCode = 2;
      return;
    }
    const result = await reconcile(prisma, await readWorkbook(file));
    console.table(result.lines);
    console.log(`Contracts that differ or are missing: ${result.differences.length}`);
    console.log(`Customers missing in the system: ${result.missingCustomers.length}`);
    console.log(result.ok ? "MATCHES" : "DIFFERENCES: do not cut over");
    const out = arg("report");
    if (out) await writeFile(out, await writeReconciliation(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const user = arg("user");
  if (!file || !user) {
    console.error(
      "Usage: --file <workbook.xlsx> --user <admin email> [--branch <name>] [--report <out.xlsx>] [--commit]",
    );
    process.exitCode = 2;
    return;
  }
  const commit = process.argv.includes("--commit");
  const result = await runImport({
    source: file,
    sourceName: basename(file),
    userEmail: user,
    branch: arg("branch"),
    commit,
    confirmProduction: process.argv.includes("--confirm-production"),
  });
  const counts = summarize(result.plan);
  console.log(commit ? "IMPORTED" : "DRY RUN: nothing was written");
  console.table(counts);
  const cleanup = result.plan.contracts.filter((contract) => contract.cleanup.length > 0).length;
  console.log(`Contracts for the owner to confirm: ${cleanup}`);
  for (const issue of result.plan.sheetIssues) {
    console.error(`Sheet ${issue.sheet}: ${issue.code}: ${issue.fields.join(", ")}`);
  }
  if (result.applied) {
    for (const sheet of ["customers", "staff", "contracts"] as const) {
      console.log(`${sheet}: created ${result.applied[sheet].created}, failed ${result.applied[sheet].failed.length}`);
    }
    console.log(`Run ${result.runId}`);
  }
  const report = arg("report");
  if (report) {
    await writeFile(report, result.report);
    console.log(`Report written to ${report}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
