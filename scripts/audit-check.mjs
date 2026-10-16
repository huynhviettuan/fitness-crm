// Dependency vulnerability gate (OWASP A03:2025 Software Supply Chain Failures).
// Fails on any high/critical advisory that is not in security/audit-allowlist.json,
// and on allowlist entries past their review date. Run: pnpm security:audit
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);

function runAudit() {
  try {
    return execFileSync("pnpm", ["audit", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
  } catch (error) {
    // pnpm audit exits non-zero when it finds anything; the JSON is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

const report = JSON.parse(runAudit());
const allowlist = JSON.parse(
  readFileSync(new URL("../security/audit-allowlist.json", import.meta.url), "utf8"),
).advisories;
const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
const today = new Date().toISOString().slice(0, 10);

const advisories = new Map();
for (const advisory of Object.values(report.advisories ?? {})) {
  const id = advisory.github_advisory_id;
  advisories.set(id, {
    id,
    package: advisory.module_name,
    severity: advisory.severity,
    title: advisory.title,
    url: advisory.url,
  });
}

const problems = [];
for (const advisory of advisories.values()) {
  if (!BLOCKING.has(advisory.severity)) continue;
  const entry = allowed.get(advisory.id);
  if (!entry)
    problems.push(
      `NOT TRIAGED  ${advisory.severity} ${advisory.package} ${advisory.id}: ${advisory.title} (${advisory.url})`,
    );
  else if (entry.reviewBy < today)
    problems.push(`REVIEW DUE   ${advisory.package} ${advisory.id} (review by ${entry.reviewBy})`);
  else console.log(`accepted     ${advisory.severity} ${advisory.package} ${advisory.id} until ${entry.reviewBy}`);
}

for (const entry of allowlist) {
  if (!advisories.has(entry.id))
    console.warn(`stale        ${entry.package} ${entry.id} is no longer reported; remove it from the allowlist`);
}

if (problems.length > 0) {
  console.error(`\nDependency audit failed:\n${problems.join("\n")}`);
  console.error("\nFix by upgrading, or triage into security/audit-allowlist.json with a reason and review date.");
  process.exit(1);
}
console.log(`\nDependency audit passed (${advisories.size} advisories, none blocking).`);
