import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBridge, type RunningBridge } from "./bridge.js";
import { parseConfig, type BridgeConfig } from "./config.js";
import { silentLogger, type Logger } from "./log.js";

// The bridge between the machine and the CRM (A-307, A-309): the machine side spoken as the TX628 speaks it, and the CRM replaced
// by a stand-in that records what reaches it and can be made to fail (the external boundary only).

const SERIAL = "8116235100093";
const KEY = `fcd_${"k".repeat(43)}`;

type Received = { key: string | undefined; body: { scans: { userCode: string; scannedAt: string }[] } };
const crm = { received: [] as Received[], status: 200, server: null as Server | null, url: "" };

beforeEach(async () => {
  crm.received = [];
  crm.status = 200;
  crm.server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      if (crm.status === 200 && request.url === "/api/v1/checkin/scans") {
        crm.received.push({ key: request.headers["x-device-key"] as string | undefined, body: JSON.parse(body) });
      }
      response.writeHead(crm.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: crm.status === 200 }));
    });
  });
  await new Promise<void>((resolve) => crm.server!.listen(0, "127.0.0.1", resolve));
  crm.url = `http://127.0.0.1:${(crm.server.address() as AddressInfo).port}`;
});

const running: { bridge: RunningBridge | null; dir: string } = { bridge: null, dir: "" };
afterEach(async () => {
  await running.bridge?.stop();
  running.bridge = null;
  await new Promise<void>((resolve) => crm.server!.close(() => resolve()));
  if (running.dir) await rm(running.dir, { recursive: true, force: true });
  running.dir = "";
});

async function start(patch: Partial<Record<string, unknown>> = {}, log: Logger = silentLogger) {
  running.dir = running.dir || (await mkdtemp(join(tmpdir(), "zk-bridge-")));
  const config: BridgeConfig = parseConfig({
    apiUrl: crm.url,
    listenHost: "127.0.0.1",
    listenPort: 0,
    queueFile: join(running.dir, "queue.json"),
    forwardIntervalSeconds: 3600,
    machines: [{ serialNumber: SERIAL, deviceKey: KEY }],
    ...patch,
  });
  running.bridge = await startBridge(config, { log });
  return `http://127.0.0.1:${running.bridge.port}`;
}

const punches = (lines: string[]) => lines.join("\n");

describe("the machine's side", () => {
  it("is told the options, then its punches are taken, kept and answered OK with their count", async () => {
    const bridge = await start();
    const options = await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&options=all&pushver=2.0.33`);
    expect(await options.text()).toContain(`GET OPTION FROM: ${SERIAL}`);

    const upload = await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG&Stamp=9999`, {
      method: "POST",
      body: punches(["2606002\t2026-10-15 07:30:12\t0\t1\t0", "2606003\t2026-10-15 07:31:00\t0\t1\t0"]),
    });
    expect(await upload.text()).toBe("OK: 2");
    await running.bridge!.forwarder.flush();

    expect(crm.received).toEqual([
      {
        key: KEY,
        body: {
          scans: [
            { userCode: "2606002", scannedAt: "2026-10-15T00:30:12.000Z" },
            { userCode: "2606003", scannedAt: "2026-10-15T00:31:00.000Z" },
          ],
        },
      },
    ]);
    expect(running.bridge!.queue.size).toBe(0);
  });

  it("answers the other tables and the command calls OK, and sends nothing for them", async () => {
    const bridge = await start();
    for (const [method, path] of [
      ["POST", `/iclock/cdata?SN=${SERIAL}&table=OPERLOG`],
      ["GET", `/iclock/getrequest?SN=${SERIAL}`],
      ["POST", `/iclock/devicecmd?SN=${SERIAL}`],
    ] as const) {
      const response = await fetch(`${bridge}${path}`, {
        method,
        ...(method === "POST" ? { body: "USER PIN=1" } : {}),
      });
      expect(await response.text(), path).toBe("OK");
    }
    await running.bridge!.forwarder.flush();
    expect(crm.received).toEqual([]);
  });

  it("refuses a machine it does not know, and a path that is not the protocol", async () => {
    const bridge = await start();
    const stranger = await fetch(`${bridge}/iclock/cdata?SN=999999999&table=ATTLOG`, {
      method: "POST",
      body: "1\t2026-10-15 07:30:12\t0\t1",
    });
    expect(stranger.status).toBe(403);
    expect((await fetch(`${bridge}/admin`)).status).toBe(404);
    await running.bridge!.forwarder.flush();
    expect(crm.received).toEqual([]);
  });

  it("refuses an upload over 1 MB", async () => {
    const bridge = await start();
    const response = await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: "1\t2026-10-15 07:30:12\t0\t1\n".repeat(60_000),
    }).catch(() => null);
    expect(response === null || response.status === 413).toBe(true);
  });
});

describe("the CRM's side", () => {
  it("keeps the punches while the CRM is down or refuses the key, and sends them once it answers", async () => {
    const bridge = await start();
    crm.status = 503;
    await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: "2606002\t2026-10-15 07:30:12\t0\t1",
    });
    await running.bridge!.forwarder.flush(0);
    expect(running.bridge!.queue.size).toBe(1);
    expect(running.bridge!.forwarder.state.lastError).toContain("503");

    crm.status = 401;
    await running.bridge!.forwarder.flush(Date.now() + 10 * 60_000);
    expect(running.bridge!.forwarder.state.lastError).toContain("not accepted");
    expect(running.bridge!.queue.size).toBe(1);

    crm.status = 200;
    await running.bridge!.forwarder.flush(Date.now() + 20 * 60_000);
    expect(crm.received.map((call) => call.body.scans.length)).toEqual([1]);
    expect(running.bridge!.queue.size).toBe(0);
  });

  it("keeps the queue on disk, so a restart sends what was waiting", async () => {
    let bridge = await start();
    crm.status = 503;
    await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: "2606002\t2026-10-15 07:30:12\t0\t1",
    });
    await running.bridge!.stop();
    const saved = JSON.parse(await readFile(join(running.dir, "queue.json"), "utf8")) as unknown[];
    expect(saved).toHaveLength(1);

    crm.status = 200;
    bridge = await start();
    expect(bridge).toBeTruthy();
    await running.bridge!.forwarder.flush();
    expect(crm.received.map((call) => call.body.scans)).toEqual([
      [{ userCode: "2606002", scannedAt: "2026-10-15T00:30:12.000Z" }],
    ]);
  });

  it("keeps a punch the machine sends twice only once", async () => {
    const bridge = await start();
    for (let index = 0; index < 2; index += 1) {
      await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
        method: "POST",
        body: "2606002\t2026-10-15 07:30:12\t0\t1",
      });
    }
    await running.bridge!.forwarder.flush();
    expect(crm.received.flatMap((call) => call.body.scans)).toHaveLength(1);
  });

  it("drops a batch the CRM refuses as malformed, so the next ones are not held up", async () => {
    const bridge = await start();
    crm.status = 400;
    await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: "2606002\t2026-10-15 07:30:12\t0\t1",
    });
    await running.bridge!.forwarder.flush();
    expect(running.bridge!.queue.size).toBe(0);
  });

  it("never writes a key in its log or its health answer", async () => {
    const lines: string[] = [];
    const log: Logger = {
      info: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
      warn: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
    };
    const bridge = await start({}, log);
    crm.status = 401;
    await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&options=all`);
    await fetch(`${bridge}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: "2606002\t2026-10-15 07:30:12\t0\t1",
    });
    await running.bridge!.forwarder.flush();
    const health = await (await fetch(`${bridge}/health`)).text();
    expect(health).toContain('"waiting":1');
    for (const text of [...lines, health]) expect(text).not.toContain(KEY);
  });
});

describe("the settings", () => {
  it("refuse an address without https, a key that is not one, and a machine listed twice", () => {
    const base = { apiUrl: "https://crm.flow.vn", machines: [{ serialNumber: SERIAL, deviceKey: KEY }] };
    expect(parseConfig(base).timeZone).toBe("Asia/Ho_Chi_Minh");
    expect(() => parseConfig({ ...base, apiUrl: "http://crm.flow.vn" })).toThrow(/https/);
    expect(() => parseConfig({ ...base, machines: [{ serialNumber: SERIAL, deviceKey: "secret" }] })).toThrow(
      /machine key/,
    );
    expect(() =>
      parseConfig({
        ...base,
        machines: [
          { serialNumber: SERIAL, deviceKey: KEY },
          { serialNumber: SERIAL, deviceKey: KEY },
        ],
      }),
    ).toThrow(/twice/);
    // The message names the field, never the value given for a key.
    const wrong = `fcd_${"w".repeat(10)}`;
    let message = "";
    try {
      parseConfig({ ...base, machines: [{ serialNumber: SERIAL, deviceKey: wrong }] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("deviceKey");
    expect(message).not.toContain(wrong);
  });
});
