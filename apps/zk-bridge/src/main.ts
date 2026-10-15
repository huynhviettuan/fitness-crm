#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startBridge } from "./bridge.js";

// The bridge at the gym (A-307, docs/33): `node dist/main.js --config zk-bridge.json`.

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const config = await loadConfig(arg("config") ?? "zk-bridge.json").catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
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
