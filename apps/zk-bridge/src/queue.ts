import { readFile, rename, writeFile } from "node:fs/promises";

// The punches waiting for the CRM (docs/33 §2). A punch is kept on disk from the moment the machine hands it over until the CRM
// has it, so the machine can be told "OK" at once and an outage or a restart of the computer loses nothing. The same punch twice
// (the machine resending) is kept once; the scan API also answers a resent scan with its stored answer (A-153).

export type QueuedScan = { serialNumber: string; userCode: string; scannedAt: string };

const keyOf = (scan: QueuedScan) => `${scan.serialNumber}|${scan.userCode}|${scan.scannedAt}`;

export class ScanQueue {
  private items: QueuedScan[] = [];
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {}

  /** The queue of the file, with what was waiting when the bridge stopped. */
  static async open(file: string): Promise<ScanQueue> {
    const queue = new ScanQueue(file);
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (Array.isArray(saved)) {
        queue.items = saved.filter(
          (item): item is QueuedScan =>
            typeof item?.serialNumber === "string" &&
            typeof item?.userCode === "string" &&
            typeof item?.scannedAt === "string",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return queue;
  }

  get size(): number {
    return this.items.length;
  }

  /** The punches of one machine, oldest first, at most `limit`. */
  pending(serialNumber: string, limit: number): QueuedScan[] {
    return this.items.filter((item) => item.serialNumber === serialNumber).slice(0, limit);
  }

  machines(): string[] {
    return [...new Set(this.items.map((item) => item.serialNumber))];
  }

  /** Keeps new punches, once each, and returns only when they are on disk. */
  async add(scans: QueuedScan[]): Promise<number> {
    const known = new Set(this.items.map(keyOf));
    const fresh = scans.filter((scan) => !known.has(keyOf(scan)) && known.add(keyOf(scan)));
    this.items.push(...fresh);
    await this.save();
    return fresh.length;
  }

  /** Forgets punches the CRM has. */
  async remove(scans: QueuedScan[]): Promise<void> {
    const done = new Set(scans.map(keyOf));
    this.items = this.items.filter((item) => !done.has(keyOf(item)));
    await this.save();
  }

  /** Resolves when everything added or removed so far is on disk. */
  idle(): Promise<void> {
    return this.writing;
  }

  /** Written to a new file and renamed over the old one, so a power cut never leaves half a file; one write at a time. */
  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.items);
    this.writing = this.writing.then(async () => {
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, this.file);
    });
    return this.writing;
  }
}
