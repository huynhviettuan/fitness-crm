import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { BridgeConfig } from "./config.js";
import type { Forwarder } from "./forwarder.js";
import type { Logger } from "./log.js";
import { classify, optionsReply, parseAttlog, toInstant } from "./protocol.js";
import type { ScanQueue } from "./queue.js";

// What the machine talks to (docs/33 §2): the ZKTeco push calls on the gym's LAN. Only the machines listed in the settings, by
// serial number, are answered; their punches are kept on disk before the machine is told "OK", then sent to the CRM.

const MAX_BODY = 1024 * 1024;

function reply(response: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** The gym's offset in whole hours, for the machine's options (Vietnam: 7). */
function zoneHours(timeZone: string): number {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 3_600_000);
}

export function createBridgeServer(config: BridgeConfig, queue: ScanQueue, forwarder: Forwarder, log: Logger): Server {
  const known = new Set(config.machines.map((machine) => machine.serialNumber));
  const hours = zoneHours(config.timeZone);

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://bridge.local");
      // For the person setting it up: is the bridge running, how much is waiting, did the last send work. No keys, no codes.
      if (url.pathname === "/health" && request.method === "GET") {
        reply(
          response,
          200,
          JSON.stringify({ waiting: queue.size, ...forwarder.state, machines: config.machines.length }),
          "application/json",
        );
        return;
      }
      const call = classify(request.method ?? "GET", url);
      if (call.kind === "unknown") {
        reply(response, 404, "Not found");
        return;
      }
      if (!known.has(call.serialNumber)) {
        log.warn("unknown machine", { serialNumber: call.serialNumber, call: call.kind });
        reply(response, 403, "Unknown machine");
        return;
      }
      switch (call.kind) {
        case "options":
          log.info("machine connected", { serialNumber: call.serialNumber });
          reply(response, 200, optionsReply(call.serialNumber, hours));
          return;
        case "punches": {
          const body = await readBody(request);
          if (body === null) {
            reply(response, 413, "Too large");
            return;
          }
          const { punches, skipped } = parseAttlog(body);
          const scans = punches.flatMap((punch) => {
            const scannedAt = toInstant(punch.local, config.timeZone);
            return scannedAt ? [{ serialNumber: call.serialNumber, userCode: punch.userCode, scannedAt }] : [];
          });
          const fresh = await queue.add(scans);
          log.info("punches received", {
            serialNumber: call.serialNumber,
            received: punches.length,
            fresh,
            skipped: skipped + punches.length - scans.length,
          });
          // The machine counts the records it sent as accepted; the bad lines are logged, not resent forever.
          reply(response, 200, `OK: ${punches.length + skipped}`);
          void forwarder.flush();
          return;
        }
        case "otherTable":
          // Users enrolled, operations, photos: not what the CRM needs (it keeps only the user code, D-072).
          await readBody(request);
          reply(response, 200, "OK");
          return;
        case "commands":
        case "commandResult":
          if (request.method === "POST") await readBody(request);
          reply(response, 200, "OK");
          return;
      }
    })().catch((error: unknown) => {
      log.warn("fault", { reason: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) reply(response, 500, "Error");
    });
  });
}
