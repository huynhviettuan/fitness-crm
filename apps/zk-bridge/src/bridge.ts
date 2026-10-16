import type { AddressInfo } from "node:net";
import { checkMachines, type MachineCheck } from "./check.js";
import type { BridgeConfig } from "./config.js";
import { Forwarder } from "./forwarder.js";
import { consoleLogger, type Logger } from "./log.js";
import { ScanQueue } from "./queue.js";
import { createBridgeServer } from "./server.js";

// The bridge put together: the queue from its file, the server the machine calls, and a timer that sends what waits (docs/33).

export type RunningBridge = {
  port: number;
  queue: ScanQueue;
  forwarder: Forwarder;
  /** The last check of the keys against the CRM (A-310); empty until it has run. */
  checks: MachineCheck[];
  stop: () => Promise<void>;
};

export async function startBridge(
  config: BridgeConfig,
  options: { log?: Logger; send?: typeof fetch } = {},
): Promise<RunningBridge> {
  const log = options.log ?? consoleLogger();
  const queue = await ScanQueue.open(config.queueFile);
  const forwarder = new Forwarder(config, queue, log, options.send ?? fetch);
  const checks: MachineCheck[] = [];
  const server = createBridgeServer(config, queue, forwarder, log, () => checks);
  await new Promise<void>((resolve) => server.listen(config.listenPort, config.listenHost, resolve));
  // What was waiting when the bridge stopped goes first; then every few seconds.
  const timer = setInterval(() => void forwarder.flush(), config.forwardIntervalSeconds * 1000);
  void forwarder.flush();
  if (queue.size > 0) log.info("resumed", { waiting: queue.size });
  // Each key is checked against the CRM, so a wrong one shows in the log at once, not at the first scan (A-310).
  const checked = checkMachines(config, options.send ?? fetch).then((results) => {
    checks.splice(0, checks.length, ...results);
    for (const check of results) {
      if (check.accepted)
        log.info("key accepted", {
          serialNumber: check.serialNumber,
          ...check.device,
          clockOffSeconds: check.clockOffSeconds,
        });
      else log.warn("key not accepted", { serialNumber: check.serialNumber, reason: check.problem });
    }
  });
  return {
    port: (server.address() as AddressInfo).port,
    queue,
    forwarder,
    checks,
    stop: async () => {
      clearInterval(timer);
      await checked;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await forwarder.flush().catch(() => undefined);
      await queue.idle();
    },
  };
}
