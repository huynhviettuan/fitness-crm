/* global console */
// The folder to copy to the gym's computer (M5.8b, docs/33): the built bridge (no dependency, so Node.js alone runs it), the
// example settings, the Windows install and uninstall scripts and the Vietnamese guide. `pnpm --filter zk-bridge package`.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release", "flow-zk-bridge");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of await readdir(join(root, "dist"))) {
  if (name.endsWith(".js") && !name.endsWith(".test.js")) await cp(join(root, "dist", name), join(out, name));
}
await writeFile(
  join(out, "package.json"),
  `${JSON.stringify({ name: "flow-zk-bridge", version, private: true, type: "module", engines: { node: ">=22" } }, null, 2)}\n`,
);
await cp(join(root, "zk-bridge.example.json"), join(out, "zk-bridge.example.json"));
// Windows PowerShell 5.1 reads a script without a byte order mark in the system code page: the scripts get one, and Windows
// line endings.
const BOM = String.fromCharCode(0xfeff);
for (const script of ["install-windows.ps1", "uninstall-windows.ps1"]) {
  const text = await readFile(join(root, "windows", script), "utf8");
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  await writeFile(join(out, script), BOM + body.split(/\r?\n/).join("\r\n"), "utf8");
}
await cp(join(root, "windows", "HUONG-DAN.txt"), join(out, "HUONG-DAN.txt"));
console.log(`Package written to ${out} (version ${version}). Zip this folder and copy it to the gym's computer.`);
