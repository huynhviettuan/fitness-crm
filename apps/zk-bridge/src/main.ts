#!/usr/bin/env node
import { checkMachines, describeChecks } from "./check.js";
import { loadConfig } from "./config.js";
import { startBridge } from "./bridge.js";

// The bridge at the gym (A-307, docs/33): `node dist/main.js --config zk-bridge.json`.
// `--check` checks the settings and each key against the CRM, prints the result and exits: 0 when all is right (A-310).

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const config = await loadConfig(arg("config") ?? "zk-bridge.json").catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
if (process.argv.includes("--check")) {
  const checks = await checkMachines(config);
  for (const line of describeChecks(checks)) console.log(line);
  const clockOff = checks.some((check) => Math.abs(check.clockOffSeconds ?? 0) > 120);
  if (clockOff)
    console.log(
      "CHÚ Ý: đồng hồ máy tính lệch hơn 2 phút so với máy chủ / this computer's clock is off by more than 2 minutes",
    );
  process.exit(checks.every((check) => check.accepted) ? 0 : 1);
}
const bridge = await startBridge(config);
console.log(
  JSON.stringify({
    time: new Date().toISOString(),
    level: "info",
    event: "listening",
    address: `${config.listenHost}:${bridge.port}`,
    crm: config.apiUrl,
    machines: config.machines.map((machine) => machine.serialNumber),
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void bridge.stop().then(() => process.exit(0));
  });
}
