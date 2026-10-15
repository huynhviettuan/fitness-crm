import type { BridgeConfig } from "./config.js";

// Checking the settings against the CRM (M5.8b, A-310): for each machine, does the CRM accept its key, which machine and branch
// does the key belong to, and how far is this computer's clock from the server's. Used at start-up and by `--check`.

export type MachineCheck = {
  serialNumber: string;
  accepted: boolean;
  /** The machine's name and branch in the CRM, when the key is accepted. */
  device?: { name: string; branch: string };
  /** This computer's clock minus the server's, in seconds (the machine's own clock is set on the machine). */
  clockOffSeconds?: number;
  problem?: string;
};

export async function checkMachines(config: BridgeConfig, send: typeof fetch = fetch): Promise<MachineCheck[]> {
  const checks: MachineCheck[] = [];
  for (const machine of config.machines) {
    try {
      const response = await send(`${config.apiUrl}/api/v1/checkin/device`, {
        headers: { "x-device-key": machine.deviceKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) {
        checks.push({
          serialNumber: machine.serialNumber,
          accepted: false,
          problem: "key refused (replaced, wrong, or the machine is switched off in the CRM)",
        });
        continue;
      }
      if (!response.ok) {
        checks.push({
          serialNumber: machine.serialNumber,
          accepted: false,
          problem: `CRM answered ${response.status}`,
        });
        continue;
      }
      const body = (await response.json()) as { name: string; branch: { name: string }; serverTime: string };
      checks.push({
        serialNumber: machine.serialNumber,
        accepted: true,
        device: { name: body.name, branch: body.branch.name },
        clockOffSeconds: Math.round((Date.now() - new Date(body.serverTime).getTime()) / 1000),
      });
    } catch (error) {
      checks.push({
        serialNumber: machine.serialNumber,
        accepted: false,
        problem: `CRM unreachable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return checks;
}

/** The checks as lines for the person setting up (Vietnamese first, as on site). */
export function describeChecks(checks: MachineCheck[]): string[] {
  return checks.map((check) =>
    check.accepted
      ? `OK  ${check.serialNumber}: khóa hợp lệ — máy "${check.device!.name}", chi nhánh "${check.device!.branch}"; lệch giờ máy tính ${check.clockOffSeconds}s / key accepted`
      : `LỖI ${check.serialNumber}: ${check.problem}`,
  );
}
