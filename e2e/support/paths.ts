import path from "node:path";
import type { Role } from "../../src/lib/permissions";

export function storageStatePath(role: Role): string {
  return path.join(import.meta.dirname, "..", ".auth", `${role.toLowerCase()}.json`);
}
