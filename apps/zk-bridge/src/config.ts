import { readFile } from "node:fs/promises";

// The bridge's settings (docs/33 §3), a JSON file on the gym's computer. It holds the machines' keys, so it stays on that computer
// and is readable only by the account that runs the bridge.

export type MachineSetting = { serialNumber: string; deviceKey: string };

export type BridgeConfig = {
  /** The CRM's address, as staff open it: https://… (http only for a computer of its own, in tests). */
  apiUrl: string;
  /** The gym's time zone; the machine's clock is read in it. */
  timeZone: string;
  /** Where the machine is told to send (its *Cloud Server Setting*): this computer's address on the LAN and this port. */
  listenHost: string;
  listenPort: number;
  /** Where punches wait until the CRM has them, so a restart or an outage loses nothing. */
  queueFile: string;
  /** Each machine by its serial number (Menu → System Info → Device Info) with the key the CRM gave it (Check-in → Machines). */
  machines: MachineSetting[];
  /** How often waiting punches are sent, in seconds. */
  forwardIntervalSeconds: number;
};

const KEY = /^fcd_[A-Za-z0-9_-]{40,100}$/;
const SERIAL = /^[A-Za-z0-9]{4,40}$/;

/** The settings, checked; every problem is named at once, and a key is never repeated in a message. */
export function parseConfig(raw: unknown): BridgeConfig {
  const problems: string[] = [];
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (name: string, fallback?: string) => {
    const found = value[name] ?? fallback;
    if (typeof found !== "string" || found.trim() === "") problems.push(`${name} is required`);
    return typeof found === "string" ? found.trim() : "";
  };
  const apiUrl = text("apiUrl").replace(/\/+$/, "");
  try {
    const url = new URL(apiUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      problems.push("apiUrl must start with https:// (the keys travel with every call)");
    }
  } catch {
    if (apiUrl !== "") problems.push("apiUrl is not an address");
  }
  const timeZone = text("timeZone", "Asia/Ho_Chi_Minh");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    problems.push(`timeZone ${timeZone} is not a time zone`);
  }
  const listenPort = Number(value.listenPort ?? 8081);
  // 0 lets the system choose a free port (tests).
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) problems.push("listenPort must be a port");
  const forwardIntervalSeconds = Number(value.forwardIntervalSeconds ?? 5);
  if (!Number.isFinite(forwardIntervalSeconds) || forwardIntervalSeconds < 1) {
    problems.push("forwardIntervalSeconds must be 1 or more");
  }
  const machines: MachineSetting[] = [];
  if (!Array.isArray(value.machines) || value.machines.length === 0)
    problems.push("machines needs at least one machine");
  for (const [index, machine] of (Array.isArray(value.machines) ? value.machines : []).entries()) {
    const entry = (machine ?? {}) as Record<string, unknown>;
    const serialNumber = typeof entry.serialNumber === "string" ? entry.serialNumber.trim() : "";
    const deviceKey = typeof entry.deviceKey === "string" ? entry.deviceKey.trim() : "";
    if (!SERIAL.test(serialNumber)) problems.push(`machines[${index}].serialNumber is not a serial number`);
    if (!KEY.test(deviceKey)) problems.push(`machines[${index}].deviceKey is not a machine key (fcd_…)`);
    if (machines.some((other) => other.serialNumber === serialNumber)) {
      problems.push(`machines[${index}].serialNumber is listed twice`);
    }
    machines.push({ serialNumber, deviceKey });
  }
  if (problems.length > 0) throw new Error(`The bridge settings are not right:\n- ${problems.join("\n- ")}`);
  return {
    apiUrl,
    timeZone,
    listenHost: typeof value.listenHost === "string" && value.listenHost.trim() ? value.listenHost.trim() : "0.0.0.0",
    listenPort,
    queueFile: text("queueFile", "zk-bridge-queue.json"),
    machines,
    forwardIntervalSeconds,
  };
}

export async function loadConfig(path: string): Promise<BridgeConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
