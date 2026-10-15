import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, gymDay } from "./support/data";

// The ZKTeco bridge end to end (A-307, A-309; docs/33; E2E-185): the built bridge runs as its own program, as at the gym; the test
// plays the TX628 and pushes its punches the ZKTeco way; the bridge sends them with the machine's key to the CRM, which pairs them
// with the booked session and confirms it (D-069, D-070).

const BRIDGE = join(import.meta.dirname, "..", "apps", "zk-bridge", "dist", "main.js");
const SERIAL = "8116235100093";

/** Starts the bridge with its own settings file; resolves with its address once it says it listens. */
async function startBridge(
  settings: Record<string, unknown>,
  dir: string,
): Promise<{ url: string; process: ChildProcess }> {
  const file = join(dir, "zk-bridge.json");
  await writeFile(file, JSON.stringify(settings));
  const child = spawn(process.execPath, [BRIDGE, "--config", file], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split("\n").find((candidate) => candidate.includes('"event":"listening"'));
      if (line) resolve(`http://${(JSON.parse(line) as { address: string }).address}`);
    });
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => reject(new Error(`bridge exited ${code}: ${output}`)));
  });
  return { url, process: child };
}

test("@smoke E2E-185: the machine pushes its punches to the bridge, and the CRM confirms the session", async ({
  apiAs,
  testTag,
}) => {
  const admin = await apiAs("ADMIN");
  const { refs, customer, trainer } = await bookingSetup(apiAs, testTag);
  const customerCode = `C${testTag}`;
  const trainerCode = `E${testTag}`;
  for (const [subject, id, code] of [
    ["customer", customer.id, customerCode],
    ["employee", trainer.id, trainerCode],
  ] as const) {
    expect((await admin.put(`/api/v1/checkin/machine-codes/${subject}/${id}`, { data: { code } })).ok()).toBe(true);
  }
  const me = (await (await admin.get("/api/v1/me")).json()) as { branches: { id: string }[] };
  const registered = await admin.post("/api/v1/checkin/devices", {
    data: { branchId: me.branches[0]!.id, name: `TX628 ${testTag}` },
  });
  const { key } = (await registered.json()) as { key: string };

  // A session yesterday at 09:00 (the waiting time has passed, so nothing is left hanging).
  const date = gymDay(-1);
  const day = date.split("/").reverse().join("-");
  const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
    date,
    startTime: "09:00",
    endTime: "10:00",
  });

  const dir = await mkdtemp(join(tmpdir(), "zk-bridge-e2e-"));
  const bridge = await startBridge(
    {
      apiUrl: test.info().project.use.baseURL,
      timeZone: "Asia/Ho_Chi_Minh",
      listenHost: "127.0.0.1",
      listenPort: 0,
      queueFile: join(dir, "queue.json"),
      forwardIntervalSeconds: 1,
      machines: [{ serialNumber: SERIAL, deviceKey: key }],
    },
    dir,
  );
  try {
    // The machine introduces itself, then pushes the two punches, in its own clock (the gym's time).
    const options = await fetch(`${bridge.url}/iclock/cdata?SN=${SERIAL}&options=all&pushver=2.0.33S&language=83`);
    expect(await options.text()).toContain(`GET OPTION FROM: ${SERIAL}`);
    const push = await fetch(`${bridge.url}/iclock/cdata?SN=${SERIAL}&table=ATTLOG&Stamp=9999`, {
      method: "POST",
      body: [`${customerCode}\t${day} 08:58:00\t0\t1\t0\t0\t0`, `${trainerCode}\t${day} 09:00:00\t0\t1\t0\t0\t0`].join(
        "\n",
      ),
    });
    expect(await push.text()).toBe("OK: 2");

    // The bridge sends them on; the session is confirmed by the machine.
    const manager = await apiAs("FITNESS_MANAGER");
    await expect
      .poll(async () => {
        const found = (await (await manager.get(`/api/v1/bookings/${booking.id}`)).json()) as {
          status: string;
          session: { confirmationMethod: string } | null;
        };
        return [found.status, found.session?.confirmationMethod ?? null];
      })
      .toEqual(["TRAINED", "DEVICE"]);
    const health = (await (await fetch(`${bridge.url}/health`)).json()) as {
      waiting: number;
      lastError: string | null;
    };
    expect(health).toMatchObject({ waiting: 0, lastError: null });
  } finally {
    bridge.process.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a machine the bridge does not know is refused, and a key the CRM does not know keeps the punches waiting", async ({
  testTag,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "zk-bridge-e2e-"));
  const bridge = await startBridge(
    {
      apiUrl: test.info().project.use.baseURL,
      listenHost: "127.0.0.1",
      listenPort: 0,
      queueFile: join(dir, "queue.json"),
      forwardIntervalSeconds: 1,
      machines: [{ serialNumber: SERIAL, deviceKey: `fcd_${"x".repeat(43)}` }],
    },
    dir,
  );
  try {
    const stranger = await fetch(`${bridge.url}/iclock/cdata?SN=123456789&table=ATTLOG`, {
      method: "POST",
      body: `X${testTag}\t2026-10-15 08:00:00\t0\t1`,
    });
    expect(stranger.status).toBe(403);
    await fetch(`${bridge.url}/iclock/cdata?SN=${SERIAL}&table=ATTLOG`, {
      method: "POST",
      body: `X${testTag}\t2026-10-15 08:00:00\t0\t1`,
    });
    await expect
      .poll(
        async () => ((await (await fetch(`${bridge.url}/health`)).json()) as { lastError: string | null }).lastError,
      )
      .toContain("401");
    const health = (await (await fetch(`${bridge.url}/health`)).json()) as { waiting: number };
    expect(health.waiting).toBe(1);
  } finally {
    bridge.process.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
