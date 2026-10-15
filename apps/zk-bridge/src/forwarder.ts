import type { BridgeConfig } from "./config.js";
import type { Logger } from "./log.js";
import type { ScanQueue } from "./queue.js";

// Sending the waiting punches to the CRM (docs/33 §2): `POST /api/v1/checkin/scans` with the machine's key, at most 500 a call
// (the API's limit, A-153). Sent punches leave the queue; on a failure they stay and the next try waits longer, up to five minutes.

const BATCH = 500;
const MAX_BACKOFF_MS = 5 * 60_000;

export type ForwardState = { lastSentAt: string | null; lastError: string | null; failures: number };

export class Forwarder {
  readonly state: ForwardState = { lastSentAt: null, lastError: null, failures: 0 };
  private nextTryAt = 0;
  private current: Promise<void> | null = null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly queue: ScanQueue,
    private readonly log: Logger,
    private readonly send: typeof fetch = fetch,
  ) {}

  /**
   * One round: every machine's waiting punches, unless the last failure says to wait. Never two rounds at once: a call during a
   * round waits for that round.
   */
  flush(now: number = Date.now()): Promise<void> {
    if (this.current) return this.current;
    if (now < this.nextTryAt || this.queue.size === 0) return Promise.resolve();
    this.current = this.round(now).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async round(now: number): Promise<void> {
    {
      for (const serialNumber of this.queue.machines()) {
        const machine = this.config.machines.find((candidate) => candidate.serialNumber === serialNumber);
        if (!machine) continue;
        for (;;) {
          const batch = this.queue.pending(serialNumber, BATCH);
          if (batch.length === 0) break;
          const outcome = await this.post(machine.deviceKey, batch);
          if (outcome === "sent" || outcome === "dropped") {
            await this.queue.remove(batch);
            continue;
          }
          this.backOff(now);
          return;
        }
      }
      this.state.failures = 0;
    }
  }

  private async post(
    deviceKey: string,
    batch: { userCode: string; scannedAt: string }[],
  ): Promise<"sent" | "dropped" | "retry"> {
    let response: Response;
    try {
      response = await this.send(`${this.config.apiUrl}/api/v1/checkin/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": deviceKey },
        body: JSON.stringify({ scans: batch.map(({ userCode, scannedAt }) => ({ userCode, scannedAt })) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.fail(`CRM unreachable: ${error instanceof Error ? error.message : String(error)}`);
      return "retry";
    }
    if (response.ok) {
      this.state.lastSentAt = new Date().toISOString();
      this.state.lastError = null;
      this.log.info("sent", { scans: batch.length });
      return "sent";
    }
    // A punch the CRM refuses as malformed would be refused forever: it is dropped and logged, so the rest are not held up.
    if (response.status === 400) {
      this.log.warn("refused", { status: 400, scans: batch.length });
      return "dropped";
    }
    // A refused key (replaced, or the machine switched off in the CRM), too many calls, or a fault: kept and tried again.
    this.fail(`CRM answered ${response.status}${response.status === 401 ? " (the machine key is not accepted)" : ""}`);
    return "retry";
  }

  private fail(message: string): void {
    this.state.lastError = message;
    this.state.failures += 1;
    this.log.warn("not sent", { reason: message, waiting: this.queue.size });
  }

  private backOff(now: number): void {
    const wait = Math.min(
      MAX_BACKOFF_MS,
      this.config.forwardIntervalSeconds * 1000 * 2 ** Math.min(this.state.failures, 8),
    );
    this.nextTryAt = now + wait;
  }
}
