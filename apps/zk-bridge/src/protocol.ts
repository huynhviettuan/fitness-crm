// The ZKTeco "PUSH" (ADMS) protocol, the part the bridge needs (A-307, A-309; docs/33). A machine with a cloud server set calls
//   GET  /iclock/cdata?SN=<serial>&options=all…      first, to learn how to send (the answer is a list of options);
//   POST /iclock/cdata?SN=<serial>&table=ATTLOG…     with its punches, one per line: PIN, time, status, verify mode…, tab-separated;
//   POST /iclock/cdata?SN=<serial>&table=OPERLOG…    with other records (users enrolled, operations), which the bridge ignores;
//   GET  /iclock/getrequest?SN=<serial>              to ask for commands (the bridge has none);
//   POST /iclock/devicecmd?SN=<serial>               to report on a command.
// The details come from the protocol as published for this generation of firmware; ZKTeco's own document for Push Service
// 2.0.33S is still awaited (OQ-062), so anything not understood is answered "OK" and logged, never an error that would make the
// machine resend forever.

/** One punch as the machine writes it: the user's number on the machine and its local wall-clock time. */
export type Punch = { userCode: string; local: string };

const PUNCH_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** The punches of an ATTLOG upload; a line that is not a punch is skipped (counted, so the log can say so). */
export function parseAttlog(body: string): { punches: Punch[]; skipped: number } {
  const punches: Punch[] = [];
  let skipped = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const [pin, time] = line.split("\t").map((field) => field.trim());
    if (!pin || !time || !/^[A-Za-z0-9_-]{1,40}$/.test(pin) || !PUNCH_TIME.test(time)) {
      skipped += 1;
      continue;
    }
    punches.push({ userCode: pin, local: time });
  }
  return { punches, skipped };
}

/** The offset, in minutes, of a time zone at an instant (Asia/Ho_Chi_Minh is +420 all year). */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The machine writes its own wall-clock time without a zone: it is read in the gym's time zone and sent as an instant, which is
 * what the scan API pairs by (D-070). Null when it is not a time.
 */
export function toInstant(local: string, timeZone: string): string | null {
  const match = PUNCH_TIME.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo! - 1 || check.getUTCDate() !== d! || h! > 23 || mi! > 59 || s! > 59) return null;
  // The offset at the wall time, then again at the result, so a change of offset that day lands right.
  let instant = wall - offsetMinutes(timeZone, new Date(wall)) * 60_000;
  instant = wall - offsetMinutes(timeZone, new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

/**
 * The answer to the machine's first call: send punches as they happen (Realtime), every record not sent yet (Stamp None), retry
 * after 30 seconds on a failure, ask for commands every 10 seconds. The time zone is the gym's, in hours.
 */
export function optionsReply(serialNumber: string, timeZoneHours: number): string {
  return [
    `GET OPTION FROM: ${serialNumber}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    `TimeZone=${timeZoneHours}`,
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");
}

/** What a request of the machine is. */
export type MachineCall =
  | { kind: "options"; serialNumber: string }
  | { kind: "punches"; serialNumber: string }
  | { kind: "otherTable"; serialNumber: string; table: string }
  | { kind: "commands"; serialNumber: string }
  | { kind: "commandResult"; serialNumber: string }
  | { kind: "unknown" };

/** The machine's serial number: letters and digits only, so it is safe in a log and a lookup. */
const SERIAL = /^[A-Za-z0-9]{4,40}$/;

export function classify(method: string, url: URL): MachineCall {
  const serialNumber = url.searchParams.get("SN") ?? "";
  if (!SERIAL.test(serialNumber)) return { kind: "unknown" };
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (path === "/iclock/cdata" && method === "GET") return { kind: "options", serialNumber };
  if (path === "/iclock/cdata" && method === "POST") {
    const table = (url.searchParams.get("table") ?? "").toUpperCase();
    return table === "ATTLOG" ? { kind: "punches", serialNumber } : { kind: "otherTable", serialNumber, table };
  }
  if (path === "/iclock/getrequest" && method === "GET") return { kind: "commands", serialNumber };
  if (path === "/iclock/devicecmd" && method === "POST") return { kind: "commandResult", serialNumber };
  return { kind: "unknown" };
}
