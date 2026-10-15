import type { AddressInfo } from "node:net";
import type { BridgeConfig } from "./config.js";
import { Forwarder } from "./forwarder.js";
import { consoleLogger, type Logger } from "./log.js";
import { ScanQueue } from "./queue.js";
import { createBridgeServer } from "./server.js";

// The bridge put together: the queue from its file, the server the machine calls, and a timer that sends what waits (docs/33).

export type RunningBridge = { port: number; queue: ScanQueue; forwarder: Forwarder; stop: () => Promise<void> };

export async function startBridge(
  config: BridgeConfig,
  options: { log?: Logger; send?: typeof fetch } = {},
): Promise<RunningBridge> {
  const log = options.log ?? consoleLogger();
  const queue = await ScanQueue.open(config.queueFile);
  const forwarder = new Forwarder(config, queue, log, options.send ?? fetch);
  const server = createBridgeServer(config, queue, forwarder, log);
  await new Promise<void>((resolve) => server.listen(config.listenPort, config.listenHost, resolve));
  // What was waiting when the bridge stopped goes first; then every few seconds.
  const timer = setInterval(() => void forwarder.flush(), config.forwardIntervalSeconds * 1000);
  void forwarder.flush();
  if (queue.size > 0) log.info("resumed", { waiting: queue.size });
  return {
    port: (server.address() as AddressInfo).port,
    queue,
    forwarder,
    stop: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await forwarder.flush().catch(() => undefined);
      await queue.idle();
    },
  };
}
